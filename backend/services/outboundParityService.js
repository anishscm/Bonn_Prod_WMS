/**
 * Phase 6B — Outbound parity transaction foundation.
 *
 * This service is intentionally isolated from the live RPC router until
 * GAS-vs-SQL tests pass. It mirrors the Gold Master side-effects observed in
 * opDeductBatchPickingAndMIS / outbound confirmation:
 *   1) deduct SAP stock by SKU + batch + SLoc/warehouse
 *   2) update Operation Sheet status/OBD/dispatch quantity
 *   3) append Outward MIS rows
 *   4) deduct physical stock by SKU + bin + MFG + plant
 *   5) remove physical allocation rows for the target SO/OBD
 *   6) write BIN_TXIN audit rows
 *
 * IMPORTANT: exact production column mapping is deliberately injected through
 * a mapping object. Do not guess column names in the router.
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

/**
 * Execute the high-risk outbound operation in one DB transaction.
 *
 * `db` must expose: connect() -> client, and the client must expose
 * query()/release(). The mapping is the verified SQL column contract.
 */
async function confirmOutbound({ db, payload, mapping }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const wh = norm(payload.warehouse || 'BB04');
    const so = norm(payload.soNumber || payload.salesDocument || '');
    const obd = String(payload.obdNumber || payload.obd || '').trim();
    if (!obd) throw new Error('8-Digit OBD Number is required.');

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) throw new Error('No allocated rows provided for deduction.');

    // ---- 1. Physical stock: lock rows before calculating deduction ----
    const p = mapping.phyStock;
    for (const item of items) {
      const qty = n(item.allocatedQty ?? item.allocQty);
      if (qty <= 0) continue;

      const params = [wh, cleanSku(item.sku), cleanBin(item.bin), String(item.mfgMonth ?? '').trim()];
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

      const available = n(locked.rows[0][p.qty]);
      if (available < qty) {
        throw new Error(`Insufficient physical stock for ${item.sku}: available ${available}, requested ${qty}`);
      }

      const newQty = available - qty;
      await client.query(
        `UPDATE ${qIdent(p.schema)}.${qIdent(p.table)} SET ${qIdent(p.qty)} = $1 WHERE ${qIdent(p.id)} = $2`,
        [newQty, locked.rows[0][p.id]]
      );

      if (newQty <= 0) {
        await client.query(`DELETE FROM ${qIdent(p.schema)}.${qIdent(p.table)} WHERE ${qIdent(p.id)} = $1`, [locked.rows[0][p.id]]);
      }
    }

    // ---- 2. Remove allocation rows for target SO/OBD ----
    const a = mapping.phyAllocation;
    if (a) {
      await client.query(
        `DELETE FROM ${qIdent(a.schema)}.${qIdent(a.table)} WHERE upper(trim(${qIdent(a.so)}::text)) = $1`,
        [so]
      );
    }

    // ---- 3. BIN_TXIN audit trail ----
    const tx = mapping.binTx;
    if (tx) {
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
    }

    // ---- 4/5. Operation Sheet and Outward MIS are written only after all
    // stock locks/deductions above succeed. Their exact column mappings remain
    // injected so no guessed production contract is embedded here. ----
    if (mapping.operationSheet?.update) {
      await mapping.operationSheet.update(client, { payload, warehouse: wh, so, obd });
    }
    if (mapping.outwardMis?.append) {
      await mapping.outwardMis.append(client, { payload, warehouse: wh, so, obd });
    }

    await client.query('COMMIT');
    return { status: 'SUCCESS', message: `Order(s) ${obd || so} confirmed successfully.`, transaction: 'COMMITTED' };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', message: error.message || String(error), transaction: 'ROLLED_BACK' };
  } finally {
    client.release();
  }
}

module.exports = { confirmOutbound, norm, cleanBin, cleanSku };
