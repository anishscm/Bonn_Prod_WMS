const assert = require('node:assert/strict');
const { deductBatchPickingAndMIS, matchBatch, parseBatchJson } = require('./batchPickingParityService');

assert.equal(matchBatch('000123', '123'), true);
assert.equal(matchBatch('B123', 'B123'), true);
assert.equal(matchBatch('B123', 'B124'), false);
assert.deepEqual(parseBatchJson('[{"batch":"B1","qty":10}]'), [{ batch: 'B1', qty: 10 }]);

function makeDb({ failMis = false } = {}) {
  const state = {
    stock: [{ id: 1, warehouse_code: 'BB04', sloc: 'FG01', sku_code: 'SKU1', batch_qty: [{ batch: '000123', qty: 70 }], total_unrestricted: 70 }],
    operation: { order_status: 'Pending', obd: '' },
    mis: [], committed: false, rolledBack: false, released: false
  };
  let snapshot = null;
  const clone = () => JSON.parse(JSON.stringify(state));
  const restore = s => Object.assign(state, s);
  const client = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (compact === 'BEGIN') { snapshot = clone(); return { rows: [] }; }
      if (compact === 'COMMIT') { state.committed = true; return { rows: [] }; }
      if (compact === 'ROLLBACK') { state.rolledBack = true; restore(snapshot); return { rows: [] }; }
      if (compact.startsWith('SELECT id, warehouse_code')) return { rows: state.stock.map(r => ({ ...r })) };
      if (compact.startsWith('UPDATE wms.sap_stock SET batch_qty')) {
        state.stock[0].batch_qty = JSON.parse(params[0]);
        state.stock[0].total_unrestricted = Number(params[1]);
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE wms.sap_stock SET total_unrestricted')) {
        state.stock[0].total_unrestricted = Number(params[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { state.released = true; }
  };
  const mapping = {
    sapStock: { schema: 'wms', table: 'sap_stock' },
    operationSheet: { update: async () => { state.operation.order_status = 'PGI Done'; } },
    outwardMis: { append: async (_client, row) => { if (failMis) throw new Error('MIS_APPEND_TEST_FAILURE'); state.mis.push(row); } }
  };
  return { db: { async connect() { return client; } }, state, mapping };
}

(async () => {
  const ok = makeDb();
  const success = await deductBatchPickingAndMIS({
    db: ok.db, mapping: ok.mapping,
    payload: {
      warehouse: 'BB04', salesDocument: 'SO-1', obdNumber: '12345678', updatedBy: 'TEST',
      allocatedRows: [{ sku: 'SKU1', desc: 'Test Item', batch: '123', allocQty: 50, sloc: 'FG01' }],
      opRowData: { plant: 'BB04', orderQty: 100, customerName: 'Customer' }
    }
  });
  assert.equal(success.status, 'SUCCESS');
  assert.equal(success.transaction, 'COMMITTED');
  assert.equal(ok.state.stock[0].batch_qty[0].qty, 20);
  assert.equal(ok.state.stock[0].total_unrestricted, 20);
  assert.equal(ok.state.operation.order_status, 'PGI Done');
  assert.equal(ok.state.mis.length, 1);
  assert.equal(ok.state.committed, true);
  assert.equal(ok.state.rolledBack, false);
  assert.equal(ok.state.released, true);

  const bad = makeDb({ failMis: true });
  const failure = await deductBatchPickingAndMIS({
    db: bad.db, mapping: bad.mapping,
    payload: {
      warehouse: 'BB04', salesDocument: 'SO-1', obdNumber: '87654321',
      allocatedRows: [{ sku: 'SKU1', batch: '123', allocQty: 10, sloc: 'FG01' }],
      opRowData: { plant: 'BB04', orderQty: 100 }
    }
  });
  assert.equal(failure.status, 'ERROR');
  assert.equal(failure.transaction, 'ROLLED_BACK');
  assert.equal(bad.state.stock[0].batch_qty[0].qty, 70);
  assert.equal(bad.state.stock[0].total_unrestricted, 70);
  assert.equal(bad.state.rolledBack, true);
  assert.equal(bad.state.committed, false);
  assert.equal(bad.state.mis.length, 0);
  assert.equal(bad.state.released, true);

  console.log('Phase 6F Gold-Master batch picking parity harness: PASS');
})();
