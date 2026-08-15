/**
 * Phase 7A — Gold-Master parity target for iwBatchInwardWithMIS(lines).
 *
 * Verified from the supplied GAS source:
 * - Stock_Entry is a six-column compatibility sheet: timestamp, MFG, BIN, SKU, name, qty.
 * - saveOrUpdateStock normalizes MFG, matches MFG+BIN+SKU, adds quantity to the first matching row,
 *   otherwise appends a new row.
 * - INWARD_MIS is grouped by OBD+SKU+MFG; received quantity is summed across bins.
 * - SAP quantity comes from the first line for that OBD/SKU/MFG group, falling back to qty.
 * - status is OK / EXCESS / SHORT from received minus SAP quantity.
 *
 * IMPORTANT: the supplied Supabase export did not include the actual 30-column
 * INWARD_MIS column contract. Therefore this service does NOT guess SQL column
 * names. The production INWARD_MIS write is an injected adapter and receives
 * the exact Gold-Master logical rows.
 *
 * SAP_STK_DUMP, PHY_STK_ENTRY and BIN_TXIN are intentionally NOT mutated here.
 * They belong to the separate iwConfirmInboundObd22 confirmation flow.
 */

function norm(v) {
  return String(v ?? '').trim().toUpperCase();
}

function normMfg(v) {
  if (v instanceof Date) {
    return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][v.getMonth()] + String(v.getFullYear()).slice(2);
  }
  const s = norm(v);
  if (!s) return '';
  if (/^[A-Z]{3}\d{2}$/.test(s)) return s;
  if (/^[A-Z]{3}\d{4}$/.test(s)) return s.slice(0, 3) + s.slice(5);
  if (s.length > 10) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) {
      return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()] + String(d.getFullYear()).slice(2);
    }
  }
  return s;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function assertMapping(mapping) {
  if (!mapping?.stockEntry?.table) throw new Error('Missing Stock_Entry compatibility mapping');
  if (typeof mapping?.inwardMis?.append !== 'function') {
    throw new Error('Missing production INWARD_MIS adapter');
  }
}

async function upsertStockEntry(client, mapping, line) {
  const s = mapping.stockEntry;
  const month = normMfg(line.month || '');
  const bin = norm(line.bin || '');
  const sku = norm(line.sku || '');
  const name = line.name || line.sku || '';
  const qty = n(line.qty);

  const existing = await client.query(
    `SELECT id, qty FROM ${s.schema}.${s.table}
      WHERE mfg_month=$1 AND bin=$2 AND sku=$3
      ORDER BY id LIMIT 1 FOR UPDATE`,
    [month, bin, sku]
  );

  if (existing.rows.length) {
    const newQty = n(existing.rows[0].qty) + qty;
    await client.query(
      `UPDATE ${s.schema}.${s.table}
          SET qty=$1, product_name=$2
        WHERE id=$3`,
      [newQty, name, existing.rows[0].id]
    );
    return { status: 'UPDATED', newQty, month, bin, sku };
  }

  const inserted = await client.query(
    `INSERT INTO ${s.schema}.${s.table}
      (mfg_month, bin, sku, product_name, qty)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, qty`,
    [month, bin, sku, name, qty]
  );
  return { status: 'SAVED', newQty: n(inserted.rows[0]?.qty), month, bin, sku };
}

async function batchInwardWithMIS({ db, mapping, lines }) {
  assertMapping(mapping);
  if (!Array.isArray(lines) || !lines.length) return { status: 'NO_DATA' };

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let saved = 0;
    const errors = [];

    // Match GAS: each line is processed independently and an error is collected
    // rather than stopping subsequent lines.
    for (const line of lines) {
      try {
        const result = await upsertStockEntry(client, mapping, line);
        if (result.status === 'SAVED' || result.status === 'UPDATED') saved += 1;
        else errors.push(`${norm(line.sku)}: ${result.status}`);
      } catch (e) {
        errors.push(`${norm(line.sku || '')}: ${e.message}`);
      }
    }

    // Exact GAS grouping: OBD + SKU + MFG. Received qty is summed across bins.
    const groups = new Map();
    for (const line of lines) {
      const obd = String(line.obd || '').trim().toUpperCase();
      const sku = norm(line.sku || '');
      const mfg = norm(line.month || '');
      const key = `${obd}||${sku}||${mfg}`;
      if (!groups.has(key)) {
        groups.set(key, {
          obd,
          obdDate: line.obdDate || '',
          vehicle: String(line.vehicle || '').trim().toUpperCase(),
          date: line.date || '',
          sku,
          mfg,
          sapQty: n(line.sapQty) || n(line.qty),
          recvQty: 0
        });
      }
      groups.get(key).recvQty += n(line.qty);
    }

    const misRows = [...groups.values()].map(r => {
      const shortExcess = r.recvQty - r.sapQty;
      return {
        ...r,
        shortExcess,
        status: shortExcess === 0 ? 'OK' : shortExcess > 0 ? 'EXCESS' : 'SHORT'
      };
    });

    // Do not guess the actual Supabase 30-column INWARD_MIS mapping.
    await mapping.inwardMis.append(client, misRows);

    await client.query('COMMIT');
    return { status: 'DONE', saved, misRows: misRows.length, errors, groups: misRows };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', error: error.message, transaction: 'ROLLED_BACK' };
  } finally {
    client.release();
  }
}

module.exports = { batchInwardWithMIS, normMfg, norm, n };
