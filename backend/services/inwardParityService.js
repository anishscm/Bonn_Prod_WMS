/**
 * Phase 7A — Gold-Master parity for iwBatchInwardWithMIS(lines).
 *
 * Verified GAS behavior:
 * - Stock_Entry is a six-column compatibility sheet: timestamp, MFG, BIN, SKU, name, qty.
 * - saveOrUpdateStock normalizes MFG, matches MFG+BIN+SKU, adds quantity to the first matching row,
 *   otherwise appends a new row.
 * - INWARD_MIS is grouped by OBD+SKU+MFG; received quantity is summed across bins.
 * - SAP quantity comes from the first line for that OBD/SKU/MFG group.
 * - status is OK / EXCESS / SHORT from received minus SAP quantity.
 * - A line failure does not abort the whole GAS function; successful lines and MIS rows still persist.
 *
 * This service intentionally does NOT add SAP_STK_DUMP, PHY_STK_ENTRY or BIN_TXIN side effects yet.
 * Those belong to the separate inward confirmation flow and must be parity-tested independently.
 */

function norm(v) {
  return String(v ?? '').trim().toUpperCase();
}

function normMfg(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    const mm = String(Number(m[1])).padStart(2, '0');
    const yy = m[2].slice(-2);
    return `${mm}/${yy}`;
  }
  return s;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function assertMapping(mapping) {
  if (!mapping?.stockEntry?.table) throw new Error('Missing Stock_Entry compatibility mapping');
  if (!mapping?.inwardMis?.table) throw new Error('Missing INWARD_MIS mapping');
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
          SET qty=$1, updated_at=now()
        WHERE id=$2`,
      [newQty, existing.rows[0].id]
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

    for (const line of lines) {
      try {
        const result = await upsertStockEntry(client, mapping, line);
        if (result.status === 'SAVED' || result.status === 'UPDATED') saved += 1;
        else errors.push(`${norm(line.sku)}: ${result.status}`);
      } catch (e) {
        // Keep the Gold-Master behavior: one bad line is recorded as an error,
        // while the batch continues. The DB transaction is committed at the end.
        errors.push(`${norm(line.sku || '')}: ${e.message}`);
      }
    }

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

    const misRows = [];
    for (const r of groups.values()) {
      const shortExcess = r.recvQty - r.sapQty;
      const status = shortExcess === 0 ? 'OK' : shortExcess > 0 ? 'EXCESS' : 'SHORT';
      misRows.push({ ...r, shortExcess, status });
    }

    const m = mapping.inwardMis;
    for (const r of misRows) {
      await client.query(
        `INSERT INTO ${m.schema}.${m.table}
          (plant_code, print_date_time, obd_no, invoice_num, invoice_date,
           vehicle_no, material_code, material_description, billed_batch,
           bill_qty, phy_batch, phy_qty, short_excess, bin, status,
           supervisor_name, deo, contractor_name, start_time, end_time,
           dock_num, shift, confirmation_datetime, grn_num, line_status,
           unloading_date, loading_supervisor_name)
         VALUES ($1,now(),$2,NULL,$3,$4,$5,NULL,$6,$7,$8,$9,$10,NULL,$11,
                 NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$12,NULL,NULL)`,
        [
          null,
          r.obd,
          r.obdDate || null,
          r.vehicle,
          r.sku,
          r.mfg,
          r.sapQty,
          r.mfg,
          r.recvQty,
          r.shortExcess,
          r.status,
          'UNLOADING'
        ]
      );
    }

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
