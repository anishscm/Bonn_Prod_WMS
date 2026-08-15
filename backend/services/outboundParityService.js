/**
 * Phase 6E — Gold-Master parity service for opConfirmOutboundDeductStock.
 *
 * This flow is NOT the Batch Picking / PGI flow. The supplied GAS source shows
 * opConfirmOutboundDeductStock directly mutates PHY_STK_ENTRY, removes
 * PHY_STK_ALLOCATION rows, writes BIN_TXIN, and updates Operation_Sheet and
 * Outward_MIS to "Confirmed". It does not mutate SAP_STK_DUMP.
 *
 * Production adapters for Operation Sheet and Outward MIS are deliberately
 * injected because their row-matching/update semantics must remain explicit.
 */

function qIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function norm(v) {
  return String(v ?? '').trim().toUpperCase();
}

function cleanBin(v) {
  return norm(v).replace(/[^A-Z0-9]/g, '').replace(/^BIN/, '');
}

function cleanSku(v) {
  return norm(v).replace(/[^A-Z0-9]/g, '');
}

function cleanMfg(v) {
  return String(v ?? '').replace(/^'/, '').trim().toUpperCase();
}

function matchWhSql(column, targetParam) {
  return `(upper(trim(${column}::text)) = $${targetParam}
    OR upper(trim(${column}::text)) = CASE WHEN $${targetParam} = 'BB04' THEN '1002' WHEN $${targetParam} = 'BB02' THEN '1001' ELSE $${targetParam} END
    OR trim(${column}::text) = ''
    OR ${column} IS NULL)`;
}

function assertProductionMapping(mapping) {
  const required = [
    ['phyStock', mapping?.phyStock],
    ['phyAllocation', mapping?.phyAllocation],
    ['binTx', mapping?.binTx],
    ['operationSheet.update', mapping?.operationSheet?.update],
    ['outwardMis.update', mapping?.outwardMis?.update]
  ];
  const missing = required.filter(([, value]) => value === undefined || value === null || (typeof value !== 'function' && typeof value !== 'object'));
  if (missing.length) throw new Error(`Incomplete production mapping: ${missing.map(([name]) => name).join(', ')}`);
}

/**
 * Exact parity target: GAS opConfirmOutboundDeductStock(payload).
 */
async function confirmOutbound({ db, payload, mapping }) {
  assertProductionMapping(mapping);
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (!payload || (!payload.soNumber && (!Array.isArray(payload.soList) || payload.soList.length === 0))) {
      throw new Error('Invalid confirmation payload: Missing SO/OBD Number(s).');
    }

    // GAS builds one target list from SO, OBD and soList and de-duplicates it.
    const targetValues = [];
    const addTargets = value => {
      if (value === undefined || value === null || value === '') return;
      String(value).split(',').forEach(v => {
        const x = norm(v);
        if (x && !targetValues.includes(x)) targetValues.push(x);
      });
    };
    addTargets(payload.soNumber);
    addTargets(payload.obdNumber);
    if (Array.isArray(payload.soList)) payload.soList.forEach(addTargets);

    const wh = norm(payload.warehouse || 'BB04');
    const items = Array.isArray(payload.items) ? payload.items : [];

    // 1) GAS updates Operation Sheet and Outward MIS to Confirmed before stock work.
    await mapping.operationSheet.update(client, {
      payload, warehouse: wh, targets: targetValues,
      status: 'Confirmed', dispatchQty: payload.totalDispatchQty || 0
    });
    await mapping.outwardMis.update(client, {
      payload, warehouse: wh, targets: targetValues,
      status: 'Confirmed', dispatchQty: payload.totalDispatchQty || 0
    });

    // 2) GAS deducts ONLY the first matching PHY_STK_ENTRY row per item.
    // It does not perform a multi-row allocation and does not throw when no
    // matching stock row is found; the BIN_TXIN audit row is still written.
    const p = mapping.phyStock;
    for (const item of items) {
      const deductQty = n(item.allocatedQty ?? item.allocQty);
      if (deductQty <= 0) continue;

      const params = [
        wh,
        cleanSku(item.sku),
        cleanBin(item.bin),
        cleanMfg(item.mfgMonth),
        'NA'
      ];
      const sql = `
        SELECT ${qIdent(p.id)}, ${qIdent(p.qty)}
        FROM ${qIdent(p.schema)}.${qIdent(p.table)}
        WHERE ${matchWhSql(qIdent(p.plant), 1)}
          AND regexp_replace(upper(trim(${qIdent(p.sku)}::text)), '[^A-Z0-9]', '', 'g') = $2
          AND regexp_replace(upper(trim(${qIdent(p.bin)}::text)), '[^A-Z0-9]', '', 'g') = $3
          AND ($4 = '' OR $4 = 'NA' OR upper(trim(${qIdent(p.mfg)}::text)) = $4 OR upper(trim(${qIdent(p.mfg)}::text)) = 'NA' OR ${qIdent(p.mfg)} IS NULL)
        ORDER BY ${qIdent(p.id)}
        LIMIT 1
        FOR UPDATE`;
      const found = await client.query(sql, params);

      if (found.rows.length) {
        const row = found.rows[0];
        const newQty = Math.max(0, n(row[p.qty]) - deductQty);
        if (newQty <= 0) {
          await client.query(
            `DELETE FROM ${qIdent(p.schema)}.${qIdent(p.table)} WHERE ${qIdent(p.id)} = $1`,
            [row[p.id]]
          );
        } else {
          await client.query(
            `UPDATE ${qIdent(p.schema)}.${qIdent(p.table)} SET ${qIdent(p.qty)} = $1, ${qIdent(p.updatedAt)} = now() WHERE ${qIdent(p.id)} = $2`,
            [newQty, row[p.id]]
          );
        }
      }
    }

    // 3) GAS removes allocations whose SO Number matches ANY target value.
    const a = mapping.phyAllocation;
    if (targetValues.length) {
      const placeholders = targetValues.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(
        `DELETE FROM ${qIdent(a.schema)}.${qIdent(a.table)}
         WHERE upper(trim(${qIdent(a.so)}::text)) IN (${placeholders})`,
        targetValues
      );
    }

    // 4) GAS always logs an OUTBOUND DEDUCT movement for every positive item.
    const tx = mapping.binTx;
    for (const item of items) {
      const qty = n(item.allocatedQty ?? item.allocQty);
      if (qty <= 0) continue;
      await client.query(
        `INSERT INTO ${qIdent(tx.schema)}.${qIdent(tx.table)}
         (${qIdent(tx.warehouse)}, ${qIdent(tx.timestamp)}, ${qIdent(tx.bin)}, ${qIdent(tx.sku)}, ${qIdent(tx.qty)}, ${qIdent(tx.mfg)}, ${qIdent(tx.type)}, ${qIdent(tx.reference)}, ${qIdent(tx.username)})
         VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
        [wh, item.bin || '', item.sku || '', qty, item.mfgMonth || '', 'OUTBOUND DEDUCT', item.soNumber || payload.soNumber || payload.obdNumber || 'BATCH_CONFIRM', payload.updatedBy || 'admin']
      );
    }

    await client.query('COMMIT');
    return {
      status: 'SUCCESS',
      message: `Order(s) ${payload.obdNumber || payload.soNumber || ''} confirmed successfully. Stock deducted and allocation updated.`,
      transaction: 'COMMITTED'
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', message: error.message || String(error), transaction: 'ROLLED_BACK' };
  } finally {
    client.release();
  }
}

module.exports = { confirmOutbound, norm, cleanBin, cleanSku, cleanMfg, assertProductionMapping };
