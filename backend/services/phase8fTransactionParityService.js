/** Phase 8F: atomic transaction contract. Test/parity layer only. */
async function runAtomicStoredOrderFlow(db, plan, writer) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await writer(client, plan);
    await client.query('COMMIT');
    return { status: 'DONE', transaction: 'COMMITTED' };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { status: 'ERROR', transaction: 'ROLLED_BACK', error: error.message };
  } finally {
    client.release();
  }
}
module.exports = { runAtomicStoredOrderFlow };
