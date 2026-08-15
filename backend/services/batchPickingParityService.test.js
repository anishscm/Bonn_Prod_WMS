const assert = require('node:assert/strict');
const { deductBatchPickingAndMIS, matchBatch, parseBatchJson } = require('./batchPickingParityService');

assert.equal(matchBatch('000123', '123'), true);
assert.equal(matchBatch('B123', 'B123'), true);
assert.equal(matchBatch('B123', 'B124'), false);
assert.deepEqual(parseBatchJson('[{"batch":"B1","qty":10}]'), [{ batch: 'B1', qty: 10 }]);

function makeDb({ failOperation = false, failMis = false } = {}) {
  const state = {
    stock: [{ id: 1, warehouse_code: 'BB04', sloc: 'FG01', sku_code: 'SKU1', batch_qty: [{ batch: '000123', qty: 70 }], total_unrestricted: 70 }],
    operation: { sales_document: 'SO-1', order_qty: 100, order_status: 'Pending', obd: '' },
    mis: [],
    committed: false,
    rolledBack: false,
    released: false
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

      if (compact.startsWith('SELECT id, warehouse_code')) {
        return { rows: state.stock.map(r => ({ ...r })) };
      }
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
    operationSheet: { update: async (_client, data) => {
      if (failOperation) throw new Error('OPERATION_UPDATE_TEST_FAILURE');
      assert.equal(data.status, 'PGI Done');
      state.operation.order_status = 'PGI Done';
      state.operation.obd = data.obdNumber;
    } },
    outwardMis: { append: async (_client, row) => {
      if (failMis) throw new Error('MIS_APPEND_TEST_FAILURE');
      state.mis.push(row);
    } }
  };
  return { db: { async connect() { return client; } }, state, mapping };
}

(async () => {
  // JSON batch deduction: 70 -> 20 for batch 000123, and PGI/MIS are written.
  const ok = makeDb();
  const result = await deductBatchPickingAndMIS({
    db: ok.db,
    mapping: ok.mapping,
    payload: {
      warehouse: 'BB04',
      salesDocument: 'SO-1',
      obdNumber: '12345678',
      updatedBy: 'TEST',
      allocatedRows: [{ sku: 'SKU1', desc: 'Test Item', batch: '123', allocQty: 50, sloc: 'FG01' }],
      opRowData: { plant: 'BB04', orderQty: 100, customerName: 'Customer' }
    }
  });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.transaction, 'COMMITTED');
  assert.equal(ok.state.stock[0].batch_qty[0].qty, 20);
  assert.equal(ok.state.stock[0].total_unrestricted, 20);
  assert.equal(ok.state.operation.order_status, 'PGI Done');
  assert.equal(ok.state.operation.obd, '12345678');
  assert.equal(ok.state.mis.length, 1);
  assert.equal(ok.state.mis[0].pgiQty, 50);
  assert.equal(ok.state.released, true);

  // Downstream MIS failure rolls back the SQL transaction and adapters.
  const bad = makeDb({ failMis: true });
  const failed = await deductBatchPickingAndMIS({
    db: bad.db,
    mapping: bad.mapping,
    payload: {
      warehouse: 'BB04', salesDocument: 'SO-1', obdNumber: '87654321',
      allocatedRows: [{ sku: 'SKU1', batch: '123', allocQty: 10, sloc: 'FG01' }],
      opRowData: { plant: 'BB04', orderQty: 100 }
    }
  });
  assert.equal(failed.status, 'ERROR');
  assert.equal(failed.transaction, 'ROLLED_BACK');
  assert.equal(bad.state.stock[0].batch_qty[0].qty, 70);
  assert.equal(bad.state.stock[0].total_unrestricted, 70);
  assert.equal(bad.state.operation.order_status, 'Pending');
  assert.equal(bad.state.mis.length, 0);
  assert.equal(bad.state.rolledBack, true);
  assert.equal(bad.state.released, true);

  console.log('Phase 6F Gold-Master batch picking parity harness: PASS');
})();
