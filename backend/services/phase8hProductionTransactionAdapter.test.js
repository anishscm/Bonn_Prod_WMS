const assert = require('assert');
const {
  assertPlan,
  buildDumpSelectSql,
  buildDumpUpdateSql,
  buildClearOrderDeleteSql,
  buildClearOrderInsertSql,
  runProductionTransaction
} = require('./phase8hProductionTransactionAdapter');

const plan = {
  warehouse: 'BB04',
  soNumber: 'SO1001',
  updatedBy: 'tester',
  dumpUpdates: [{
    id: 7, warehouse: 'BB04', material: 'SKU-A', batchQty: '[{"batch":"B001","qty":20}]',
    totalUnrestricted: 20, totalTransit: 0
  }],
  clearOrder: {
    warehouse: 'BB04', soNumber: 'SO1001', soDate: '2026-08-16',
    partyNameDestCityName: 'TEST / DELHI', reference: 'REF1', submitTime: '2026-08-16T12:00:00Z',
    totalLines: 1, linesJson: '[{"sku":"SKU-A","qty":80}]', dumpUpdatedPostPgi: 'YES'
  }
};

assertPlan(plan);
assert.strictEqual(buildDumpSelectSql([7]).values[0], 7);
assert(buildDumpUpdateSql(plan.dumpUpdates[0], 'tester').text.includes('UPDATE wms.sap_stk_dump'));
assert(buildClearOrderDeleteSql('BB04','SO1001').text.includes('warehouse = $1 AND so_number = $2'));
assert(buildClearOrderInsertSql(plan.clearOrder, 'tester').text.includes('INSERT INTO wms.clear_order'));

function fakeDb() {
  const calls = [];
  const client = {
    query: async (text, values=[]) => {
      calls.push({text, values});
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return {rowCount: 0, rows: []};
      if (text.startsWith('SELECT id, warehouse')) return {rowCount: 1, rows: [{
        id: 7, warehouse: 'BB04', material: 'SKU-A', batch_qty: '[{"batch":"B001","qty":100}]',
        total_unrestricted: 100, total_transit: 0, updated_at: 'before'
      }]};
      if (text.startsWith('UPDATE wms.sap_stk_dump')) return {rowCount: 1, rows: []};
      if (text.startsWith('DELETE FROM wms.clear_order')) return {rowCount: 1, rows: []};
      if (text.startsWith('INSERT INTO wms.clear_order')) return {rowCount: 1, rows: [{id: 99}]};
      throw new Error('unexpected query');
    }
  };
  return {calls, client};
}

(async () => {
  const dry = fakeDb();
  const dryResult = await runProductionTransaction(dry.client, plan, {execute:false, updatedBy:'tester'});
  assert.strictEqual(dryResult.status, 'DRY_RUN');
  assert.strictEqual(dryResult.transaction, 'ROLLED_BACK');
  assert.strictEqual(dryResult.writes, 0);
  assert.strictEqual(dry.calls.filter(x => x.text === 'COMMIT').length, 0);
  assert.strictEqual(dry.calls.filter(x => x.text === 'ROLLBACK').length, 1);

  const live = fakeDb();
  const liveResult = await runProductionTransaction(live.client, plan, {execute:true, updatedBy:'tester'});
  assert.strictEqual(liveResult.status, 'DONE');
  assert.strictEqual(liveResult.transaction, 'COMMITTED');
  assert.strictEqual(liveResult.writes, 2);
  assert.strictEqual(live.calls.filter(x => x.text === 'COMMIT').length, 1);

  const mismatch = fakeDb();
  mismatch.client.query = async (text, values=[]) => {
    mismatch.calls.push({text, values});
    if (text === 'BEGIN') return {rowCount:0,rows:[]};
    if (text === 'ROLLBACK') return {rowCount:0,rows:[]};
    if (text.startsWith('SELECT id, warehouse')) return {rowCount:0,rows:[]};
    throw new Error('unexpected query');
  };
  const bad = await runProductionTransaction(mismatch.client, plan, {execute:true});
  assert.strictEqual(bad.status, 'ERROR');
  assert.strictEqual(bad.transaction, 'ROLLED_BACK');
  console.log('Phase 8H production transaction adapter: PASS');
})();
