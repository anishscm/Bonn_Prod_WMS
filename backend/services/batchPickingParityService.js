/**
 * Phase 6F — Gold-Master parity service for opDeductBatchPickingAndMIS.
 *
 * Verified GAS semantics:
 *   1) deduct allocated quantities from SAP_STK_DUMP
 *   2) support both plain batch cells and JSON batch arrays
 *   3) preserve warehouse aliases BB04/1002 and BB02/1001
 *   4) match batches exactly after normalization / leading-zero compatibility
 *   5) update the first matching Operation Sheet row to PGI Done
 *   6) append one Outward MIS row per positive allocated line
 *
 * PostgreSQL uses sap_stock.batch_qty JSONB as the SAP_STK_DUMP equivalent.
 * All DB mutations are wrapped in one transaction so SQL cannot leave a
 * partially migrated PGI operation behind.
 */

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function norm(v) {
  return String(v ?? '').trim().toUpperCase();
}

function cleanMfg(v) {
  return norm(v).replace(/[^0-9]/g, '');
}

function matchWarehouse(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!y || y === 'ALL') return true;
  if (x === y) return true;
  return ((x === 'BB04' || x === '1002') && (y === 'BB04' || y === '1002')) ||
         ((x === 'BB02' || x === '1001') && (y === 'BB02' || y === '1001'));
}

function matchBatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.replace(/^0+/, '') === y.replace(/^0+/, '');
}

function parseBatchJson(value) {
  if (Array.isArray(value)) return value.map(x => ({ ...x }));
  if (value && typeof value === 'object') {
    // Accept an object keyed by batch as a compatibility representation.
    return Object.entries(value).map(([batch, qty]) => ({ batch, qty }));
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parseBatchJson(parsed);
    } catch (_) {}
  }
  return null;
}

function serializeBatchJson(original, batches) {
  if (Array.isArray(original) || (typeof original === 'string' && original.trim().startsWith('['))) {
    return batches.filter(b => n(b.qty) > 0);
  }
  const obj = {};
  batches.forEach(b => {
    if (n(b.qty) > 0) obj[String(b.batch ?? '')] = n(b.qty);
  });
  return obj;
}

function assertProductionMapping(mapping) {
  const required = [
    ['sapStock', mapping?.sapStock],
    ['operationSheet.update', mapping?.operationSheet?.update],
    ['outwardMis.append', mapping?.outwardMis?.append]
  ];
  const missing = required.filter(([, value]) => value === undefined || value === null || (typeof value !== 'function' && typeof value !== 'object'));
  if (missing.length) throw new Error(`Incomplete batch-picking production mapping: ${missing.map(([name]) => name).join(', ')}`);
}

/**
 * Exact parity target: GAS opDeductBatchPickingAndMIS(...).
 */
async function deductBatchPickingAndMIS({ db, payload, mapping }) {
  assertProductionMapping(mapping);
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const warehouse = norm(payload?.warehouse || 'BB04');
    const salesDocument = norm(payload?.salesDocument || '');
    const obdNumber = String(payload?.obdNumber || '').trim();
    const allocatedRows = Array.isArray(payload?.allocatedRows) ? payload.allocatedRows : [];
    const opRowData = payload?.opRowData || {};

    if (!obdNumber) throw new Error('8-Digit OBD Number is required.');
    if (!allocatedRows.length) throw new Error('No allocated rows provided for deduction.');

    const s = mapping.sapStock;
    const lastMatState = { value: '' };
    const misRows = [];

    // GAS loops every allocated line and then scans matching SAP_STK_DUMP rows
    // until the allocated quantity is consumed. It does NOT require a complete
    // deduction before continuing to Operation Sheet / Outward MIS.
    for (const inputRow of allocatedRows) {
      let allocQty = n(inputRow.allocQty);
      if (allocQty <= 0) continue;

      let mat = norm(inputRow.sku);
      if (mat.includes('SPLIT') || !mat) mat = lastMatState.value;
      else lastMatState.value = mat;

      const batchName = norm(inputRow.batch);
      const sloc = norm(inputRow.sloc);

      const rows = await client.query(
        `SELECT id, warehouse_code, sloc, sku_code, description, batch_qty,
                total_unrestricted
           FROM ${s.schema}.${s.table}
          WHERE UPPER(TRIM(warehouse_code)) IN ($1, CASE WHEN $1='BB04' THEN '1002' WHEN $1='BB02' THEN '1001' ELSE $1 END)
            AND UPPER(TRIM(sku_code)) = $2
            AND ($3='' OR UPPER(TRIM(sloc))=$3 OR UPPER(TRIM(sloc))='')
          ORDER BY id
          FOR UPDATE`,
        [warehouse, mat, sloc]
      );

      for (const row of rows.rows) {
        if (allocQty <= 0) break;

        const raw = row.batch_qty;
        const batches = parseBatchJson(raw);

        if (batches) {
          let matched = false;
          for (const b of batches) {
            if (allocQty <= 0) break;
            if (!matchBatch(b.batch, batchName) || n(b.qty) <= 0) continue;
            const deduct = Math.min(allocQty, n(b.qty));
            b.qty = n(b.qty) - deduct;
            allocQty -= deduct;
            matched = true;
          }
          if (matched) {
            const remaining = batches.filter(b => n(b.qty) > 0);
            const newTotal = remaining.reduce((sum, b) => sum + n(b.qty), 0);
            await client.query(
              `UPDATE ${s.schema}.${s.table}
                  SET batch_qty=$1::jsonb, total_unrestricted=$2
                WHERE id=$3`,
              [JSON.stringify(serializeBatchJson(raw, remaining)), newTotal, row.id]
            );
          }
        } else {
          // The Gold Master accepts a plain batch representation as well.
          const rowBatch = norm(row.batch ?? row.batch_no ?? row.batch_code ?? '');
          if (matchBatch(rowBatch, batchName) || batchName === '-' || batchName === 'DEFAULT' || !batchName) {
            const current = n(row.total_unrestricted);
            const deduct = Math.min(allocQty, current);
            allocQty -= deduct;
            await client.query(
              `UPDATE ${s.schema}.${s.table}
                  SET total_unrestricted=$1
                WHERE id=$2`,
              [Math.max(0, current - deduct), row.id]
            );
          }
        }
      }
    }

    // Operation Sheet: first row matching OBD, otherwise the pending SO row
    // with matching order quantity. This mirrors the GAS break-after-first-hit.
    await mapping.operationSheet.update(client, {
      warehouse,
      salesDocument,
      obdNumber,
      totalPgiQty: allocatedRows.reduce((sum, r) => sum + n(r.allocQty), 0),
      opRowData,
      status: 'PGI Done'
    });

    // Outward_MIS: one row per positive allocated line, carrying the same
    // master/order context used by the Gold Master.
    let lastMat = '';
    let lastDesc = '';
    for (const r of allocatedRows) {
      const pgiQty = n(r.allocQty);
      if (pgiQty <= 0) continue;

      let sku = norm(r.sku);
      if (sku.includes('SPLIT') || !sku) sku = lastMat;
      else {
        lastMat = sku;
        lastDesc = r.desc || '';
      }

      const batch = r.batch && r.batch !== '-' ? r.batch : '';
      misRows.push({
        warehouse: opRowData.plant || warehouse || 'BB04',
        plant: opRowData.plant || warehouse || 'BB04',
        salesDocument,
        orderDate: opRowData.orderDate || null,
        customerName: opRowData.customerName || '',
        customerRefNo: opRowData.customerRefNo || '',
        orderQty: n(opRowData.orderQty),
        shortageQty: n(opRowData.shortageQty),
        allocationRemark: opRowData.allocationRemark || '',
        shortageRemark: opRowData.shortageRemark || '',
        obd: obdNumber,
        orderStatus: 'PGI Done',
        vehicleNumber: opRowData.vehicleNumber || '',
        driverNumber: opRowData.driverNumber || '',
        tptName: opRowData.tptName || '',
        sku,
        description: lastDesc || r.desc || 'Item Description',
        batch,
        pgiQty,
        dispatchQty: pgiQty,
        shortageReason: opRowData.shortageReason || '',
        loadingSupervisor: opRowData.loadingSupervisor || '',
        billingSupervisor: opRowData.billingSupervisor || '',
        shift: opRowData.shift || '',
        loadingDate: opRowData.loadingDate || null,
        contractorName: opRowData.contractorName || '',
        loadingStartTime: opRowData.loadingStartTime || null,
        loadingEndTime: opRowData.loadingEndTime || '',
        allocatedQty: pgiQty,
        pgi: 'PGI Done',
        status: 'PGI Done',
        supervisorName: opRowData.loadingSupervisor || '',
        operatorName: payload?.updatedBy || ''
      });
    }

    for (const row of misRows) {
      await mapping.outwardMis.append(client, row);
    }

    await client.query('COMMIT');
    return {
      status: 'SUCCESS',
      message: 'Batch Picking completed successfully!',
      transaction: 'COMMITTED',
      deductedLines: allocatedRows.filter(r => n(r.allocQty) > 0).length,
      outwardMisRows: misRows.length
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', message: error.message || String(error), transaction: 'ROLLED_BACK' };
  } finally {
    client.release();
  }
}

module.exports = {
  deductBatchPickingAndMIS,
  norm,
  cleanMfg,
  matchWarehouse,
  matchBatch,
  parseBatchJson,
  serializeBatchJson,
  assertProductionMapping
};
