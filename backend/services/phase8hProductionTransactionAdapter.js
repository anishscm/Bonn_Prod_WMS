/**
 * Phase 8H — server-side production transaction adapter.
 *
 * Safety: production writes are disabled unless the caller explicitly passes
 * { execute: true }. The adapter never contains credentials; the database
 * client/connection must be supplied by server-side code.
 *
 * Intended connection: a server-side PostgreSQL client using a secret
 * DATABASE_URL/service credential. Never expose that credential to browser
 * code or commit it to the repository.
 */

function norm(v) { return String(v ?? '').trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function assertPlan(plan) {
  if (!plan || !norm(plan.warehouse) || !norm(plan.soNumber)) {
    throw new Error('warehouse and soNumber are required');
  }
  if (!Array.isArray(plan.dumpUpdates)) throw new Error('dumpUpdates must be an array');
  if (!plan.clearOrder) throw new Error('clearOrder payload is required');
  for (const u of plan.dumpUpdates) {
    if (!Number.isInteger(Number(u.id))) throw new Error('each dump update requires numeric id');
    if (num(u.totalUnrestricted) < 0 || num(u.totalTransit) < 0) {
      throw new Error('negative final stock is not allowed');
    }
  }
}

function buildDumpSelectSql(ids) {
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  return {
    text: `SELECT id, warehouse, s_loc, material, material_description, batch_qty, total_unrestricted, total_transit, updated_at\n       FROM wms.sap_stk_dump\n      WHERE id IN (${placeholders})\n      ORDER BY id\n      FOR UPDATE`,
    values: ids
  };
}

function buildDumpUpdateSql(u, updatedBy) {
  return {
    text: `UPDATE wms.sap_stk_dump\n          SET batch_qty = $1, total_unrestricted = $2, total_transit = $3, updated_at = now()\n        WHERE id = $4\n          AND warehouse = $5\n          AND material = $6`,
    values: [String(u.batchQty ?? ''), num(u.totalUnrestricted), num(u.totalTransit), Number(u.id), norm(u.warehouse), norm(u.material)],
    updatedBy: norm(updatedBy)
  };
}

function buildClearOrderDeleteSql(warehouse, soNumber) {
  return {
    text: 'DELETE FROM wms.clear_order WHERE warehouse = $1 AND so_number = $2',
    values: [norm(warehouse), norm(soNumber)]
  };
}

function buildClearOrderInsertSql(order, updatedBy) {
  return {
    text: `INSERT INTO wms.clear_order\n      (warehouse, so_number, so_date, party_name_dest_city_name, reference, submit_time,\n       total_lines, lines_json, dump_updated_post_pgi, updated_by)\n      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)\n      RETURNING id`,
    values: [
      norm(order.warehouse), norm(order.soNumber), order.soDate || null,
      order.partyNameDestCityName || '', order.reference || '', order.submitTime || null,
      Number(order.totalLines || 0), String(order.linesJson || '[]'),
      String(order.dumpUpdatedPostPgi ?? ''), norm(updatedBy)
    ]
  };
}

async function runProductionTransaction(client, plan, options = {}) {
  assertPlan(plan);
  const execute = options.execute === true;
  const updatedBy = norm(options.updatedBy || plan.updatedBy || 'phase8h-adapter');
  const ids = plan.dumpUpdates.map(u => Number(u.id));

  await client.query('BEGIN');
  try {
    const locked = await client.query(buildDumpSelectSql(ids).text, buildDumpSelectSql(ids).values);

    if (locked.rowCount !== ids.length) {
      throw new Error(`stock snapshot mismatch: expected ${ids.length}, found ${locked.rowCount}`);
    }

    const before = locked.rows.map(r => ({
      id: Number(r.id),
      warehouse: norm(r.warehouse),
      material: norm(r.material),
      batchQty: String(r.batch_qty ?? ''),
      totalUnrestricted: num(r.total_unrestricted),
      totalTransit: num(r.total_transit),
      updatedAt: r.updated_at
    }));

    // Dry-run deliberately rolls back even when all validations pass.
    if (!execute) {
      await client.query('ROLLBACK');
      return { status: 'DRY_RUN', transaction: 'ROLLED_BACK', before, writes: 0 };
    }

    for (const u of plan.dumpUpdates) {
      const q = buildDumpUpdateSql(u, updatedBy);
      const result = await client.query(q.text, q.values);
      if (result.rowCount !== 1) throw new Error(`stock update failed for dump id ${u.id}`);
    }

    await client.query(buildClearOrderDeleteSql(plan.warehouse, plan.soNumber).text,
      buildClearOrderDeleteSql(plan.warehouse, plan.soNumber).values);

    const insert = buildClearOrderInsertSql(plan.clearOrder, updatedBy);
    const inserted = await client.query(insert.text, insert.values);
    if (inserted.rowCount !== 1) throw new Error('clear_order insert failed');

    await client.query('COMMIT');
    return { status: 'DONE', transaction: 'COMMITTED', before, writes: plan.dumpUpdates.length + 1, clearOrderId: inserted.rows[0]?.id ?? null };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', transaction: 'ROLLED_BACK', error: error.message };
  }
}

module.exports = {
  assertPlan,
  buildDumpSelectSql,
  buildDumpUpdateSql,
  buildClearOrderDeleteSql,
  buildClearOrderInsertSql,
  runProductionTransaction
};
