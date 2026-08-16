/**
 * Phase 8A — Gold-Master allocation reset parity.
 *
 * Verified source contract:
 * - ocResetAllocation(activeWarehouse) is admin-gated in the UI.
 * - The allocation view passes the active warehouse to the RPC.
 * - Successful response is { status: 'DONE' } and the allocation view reloads.
 * - SQL target is wms.sap_stk_allocation.
 *
 * This service intentionally implements ONLY the verified reset operation.
 * Order allocation / Short-BT/AT calculation remains a separate gate because
 * the exact Gold-Master allocation algorithm must be ported from its source.
 */

function assertWarehouse(warehouse) {
  const w = String(warehouse ?? '').trim();
  if (!w) throw new Error('Warehouse is required');
  return w;
}

async function resetAllocation({ db, warehouse }) {
  const wh = assertWarehouse(warehouse);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'DELETE FROM wms.sap_stk_allocation WHERE warehouse = $1',
      [wh]
    );
    await client.query('COMMIT');
    return { status: 'DONE', warehouse: wh, deleted: result.rowCount };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', warehouse: wh, error: error.message, transaction: 'ROLLED_BACK' };
  } finally {
    client.release();
  }
}

module.exports = { resetAllocation, assertWarehouse };
