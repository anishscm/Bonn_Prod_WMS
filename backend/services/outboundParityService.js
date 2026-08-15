/**
 * Phase 6E — Outbound parity transaction service.
 *
 * Production mappings are deliberately injected. The verified Supabase schema
 * confirms the concrete column names, but business semantics (especially SAP
 * dump batch representation and GAS status values) must not be guessed.
 *
 * Required atomic side-effects:
 *   1) physical stock deduction (wms.phy_stk_entry)
 *   2) physical allocation removal (wms.phy_stk_allocation)
 *   3) BIN_TXIN audit row(s) (wms.bin_txin)
 *   4) SAP stock effect (wms.sap_stk_dump) via verified adapter
 *   5) Operation Sheet effect via verified adapter
 *   6) Outward MIS effect via verified adapter
 *
 * If any required adapter is missing or throws, the whole transaction rolls back.
 */

function qIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
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

function assertProductionMapping(mapping) {
  const required = [
    ['phyStock', mapping?.phyStock],
    ['phyAllocation', mapping?.phyAllocation],
    ['binTx', mapping?.binTx],
    ['sapDump.deduct', mapping?.sapDump?.deduct],
    ['operationSheet.update', mapping?.operationSheet?.update],
    ['outwardMis.append', mapping?.outwardMis?.append]
  ];
  const missing = required.filter(([, value]) => typeof value === 'undefined' || value === null || (typeof value !== 'function' && typeof value !== 'object'));
  if (missing.length) {
    throw new Error(`Incomplete production mapping: ${missing.map(([name]) => name).join(', ')}`);
  }
}

/**
 * Execute the high-risk outbound operation in one DB transaction.
 *
 * `db` must expose connect() -> client, and the client must expose
 * query()/release(). The mapping is the verified SQL column contract.
 */
async function confirmOutbound({ db, payload, mapping }) {
  assertProductionMapping(mapping);
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const wh = norm(payload.warehouse || 'BB04');
    const plant = norm(payload.plant || wh);
    const so = norm(payload.soNumber || payload.salesDocument || '');
    const obd = String(payload.obdNumber || payload.obd || '').trim();
    if (!obd) throw new Error('8-Digit OBD Number is required.');

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) throw new Error('No allocated rows provided for deduction.');

    // ---- 1. Physical stock: lock ALL matching rows before calculating deduction ----
    // Multiple rows for the same SKU/bin/MFG can exist. Deduct across locked rows
    // instead of only the first row; otherwise valid stock can be reported short.
    const p = mapping.phyStock;
    for (const item of items) {
      let remaining = n(item.allocatedQty ?? item.allocQty);
      if (remaining <= 0) continue;

      const params = [plant, cleanSku(item.sku), cleanBin(item.bin), String(item.mfgMonth ?? '').trim()];
      const sql = `
        SELECT ${qIdent(p.id)}, ${qIdent(p.qty)}
        FROM ${qIdent(p.schema)}.${qIdent(p.table)}
        WHERE ${qIdent(p.plant)} = $1
          AND regexp_replace(upper(trim(${qIdent(p.sku)})), '[^A-Z0-9]', '', 'g') = $2
          AND regexp_replace(upper(trim(${qIdent(p.bin)})), '[^A-Z0-9]', '', 'g') = $3
          AND ($4 = '' OR ${qIdent(p.mfg)}::text = $4)
        ORDER BY ${qIdent(p.id)}
        FOR UPDATE`;

      const locked = await client.query(sql, params);
      if (!locked.rows.length) {
        throw new Error(`Physical stock row not found for ${item.sku}/${item.bin}/${item.mfgMonth || ''}`);
      }

      const totalAvailable = locked.rows.reduce((sum, row) => sum + n(row[p.qty]), 0);
      if (totalAvailable < remaining) {
        throw new Error(`Insufficient physical stock for ${item.sku}: available ${totalAvailable}, requested ${remaining}`);
      }

      for (const row of locked.rows) {
        if (remaining <= 0) break;
        const available = n(row[p.qty]);
        const take = Math.min(available, remaining);
        const newQty = available - take;
        remaining -= take;

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

    // ---- 2. Remove physical allocation rows for the confirmed SO ----
    const a = mapping.phyAllocation;
    await client.query(
      `DELETE FROM ${qIdent(a.schema)}.${qIdent(a.table)}
       WHERE upper(trim(${qIdent(a.warehouse)}::text)) = $1
         AND upper(trim(${qIdent(a.so)}::text)) = $2`,
      [wh, so]
    );

    // ---- 3. BIN_TXIN audit trail ----
    const tx = mapping.binTx;
    for (const item of items) {
      const qty = n(item.allocatedQty ?? item.allocQty);
      if (qty <= 0) continue;
      await client.query(
        `INSERT INTO ${qIdent(tx.schema)}.${qIdent(tx.table)}
         (${qIdent(tx.warehouse)}, ${qIdent(tx.timestamp)}, ${qIdent(tx.bin)}, ${qIdent(tx.sku)}, ${qIdent(tx.qty)}, ${qIdent(tx.mfg)}, ${qIdent(tx.type)}, ${qIdent(tx.reference)}, ${qIdent(tx.username)})
         VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
        [wh, item.bin || '', item.sku || '', qty, item.mfgMonth || '', 'OUTBOUND DEDUCT', so || obd, payload.updatedBy || 'admin']
      );
    }

    // ---- 4. SAP stock effect — mandatory verified adapter ----
    await mapping.sapDump.deduct(client, { payload, warehouse: wh, plant, so, obd, items });

    // ---- 5/6. Operation Sheet + Outward MIS — mandatory verified adapters ----
    await mapping.operationSheet.update(client, { payload, warehouse: wh, plant, so, obd, items });
    await mapping.outwardMis.append(client, { payload, warehouse: wh, plant, so, obd, items });

    await client.query('COMMIT');
    return { status: 'SUCCESS', message: `Order ${obd || so} confirmed successfully.`, transaction: 'COMMITTED' };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', message: error.message || String(error), transaction: 'ROLLED_BACK' };
  } finally {
    client.release();
  }
}

module.exports = { confirmOutbound, norm, cleanBin, cleanSku, assertProductionMapping };
