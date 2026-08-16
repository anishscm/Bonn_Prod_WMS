const assert = require('assert');
const { resetAllocation } = require('./allocationParityService');

function fakeDb(seedRows, failCommit = false) {
  const rows = [...seedRows];
  return {
    rows,
    async connect() {
      let working = rows.map(r => ({ ...r }));
      return {
        async query(sql, params = []) {
          if (sql === 'BEGIN') { working = rows.map(r => ({ ...r })); return { rowCount: 0, rows: [] }; }
          if (sql.startsWith('DELETE FROM wms.sap_stk_allocation')) {
            const wh = params[0];
            const before = working.length;
            working = working.filter(r => r.warehouse !== wh);
            return { rowCount: before - working.length, rows: [] };
          }
          if (sql === 'COMMIT') {
            if (failCommit) throw new Error('forced commit failure');
            rows.splice(0, rows.length, ...working);
            return { rowCount: 0, rows: [] };
          }
          if (sql === 'ROLLBACK') { working = rows.map(r => ({ ...r })); return { rowCount: 0, rows: [] }; }
          throw new Error(`unexpected SQL: ${sql}`);
        },
        release() {}
      };
    }
  };
}

(async () => {
  // Warehouse-scoped reset: BB04 is cleared, BB02 survives.
  const db = fakeDb([
    { warehouse: 'BB04', so_number: 'SO1', sku: 'SKU1', inhand_alloc: 10 },
    { warehouse: 'BB04', so_number: 'SO2', sku: 'SKU2', inhand_alloc: 20 },
    { warehouse: 'BB02', so_number: 'SO3', sku: 'SKU3', inhand_alloc: 30 }
  ]);
  const result = await resetAllocation({ db, warehouse: 'BB04' });
  assert.strictEqual(result.status, 'DONE');
  assert.strictEqual(result.deleted, 2);
  assert.deepStrictEqual(db.rows, [
    { warehouse: 'BB02', so_number: 'SO3', sku: 'SKU3', inhand_alloc: 30 }
  ]);

  // Missing warehouse is rejected before any transaction is opened.
  await assert.rejects(() => resetAllocation({ db: fakeDb([]), warehouse: '' }), /Warehouse is required/);

  // Failed commit must not expose a partial delete.
  const rollbackDb = fakeDb([
    { warehouse: 'BB04', so_number: 'SO9', sku: 'SKU9', inhand_alloc: 5 }
  ], true);
  const rollbackResult = await resetAllocation({ db: rollbackDb, warehouse: 'BB04' });
  assert.strictEqual(rollbackResult.status, 'ERROR');
  assert.strictEqual(rollbackResult.transaction, 'ROLLED_BACK');
  assert.strictEqual(rollbackDb.rows.length, 1);

  console.log('Phase 8A allocation reset parity: PASS');
})();
