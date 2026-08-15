const assert = require('node:assert/strict');
const { batchInwardWithMIS, normMfg } = require('./inwardParityService');

assert.equal(normMfg('8/2026'), '08/26');
assert.equal(normMfg('08/26'), '08/26');

function makeDb({ failInsert = false } = {}) {
  const state = {
    stock: [{ id: 1, mfg_month: '08/26', bin: 'FG01', sku: 'SKU-A', qty: 100 }],
    mis: [],
    committed: false,
    rolledBack: false,
    released: false
  };
  let snapshot;

  const clone = () => JSON.parse(JSON.stringify(state));
  const restore = saved => {
    state.stock = saved.stock;
    state.mis = saved.mis;
  };

  const client = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q === 'BEGIN') { snapshot = clone(); return { rows: [] }; }
      if (q === 'COMMIT') { state.committed = true; return { rows: [] }; }
      if (q === 'ROLLBACK') { state.rolledBack = true; restore(snapshot); return { rows: [] }; }

      if (q.startsWith('SELECT id, qty FROM wms.stock_entry_compat')) {
        return { rows: state.stock.filter(r => r.mfg_month === params[0] && r.bin === params[1] && r.sku === params[2]).slice(0, 1).map(r => ({ id: r.id, qty: r.qty })) };
      }
      if (q.startsWith('UPDATE wms.stock_entry_compat')) {
        const row = state.stock.find(r => r.id === params[1]);
        row.qty = Number(params[0]);
        return { rows: [] };
      }
      if (q.startsWith('INSERT INTO wms.stock_entry_compat')) {
        const id = state.stock.length + 1;
        state.stock.push({ id, mfg_month: params[0], bin: params[1], sku: params[2], qty: Number(params[4]) });
        return { rows: [{ id, qty: Number(params[4]) }] };
      }
      if (q.startsWith('INSERT INTO wms.inward_mis')) {
        if (failInsert) throw new Error('INWARD_MIS_TEST_FAILURE');
        state.mis.push({ obd: params[1], sku: params[4], mfg: params[5], sapQty: params[6], recvQty: params[8], shortExcess: params[9], status: params[10] });
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { state.released = true; }
  };
  return { db: { async connect() { return client; } }, state };
}

const mapping = {
  stockEntry: { schema: 'wms', table: 'stock_entry_compat' },
  inwardMis: { schema: 'wms', table: 'inward_mis' }
};

(async () => {
  // Existing Stock_Entry key: add quantity to the first matching row.
  const ok = makeDb();
  const result = await batchInwardWithMIS({
    db: ok.db,
    mapping,
    lines: [
      { obd: 'OBD-P7', obdDate: '2026-08-16', vehicle: 'HR01AA0001', date: '2026-08-16', sku: 'SKU-A', month: '08/26', bin: 'FG01', name: 'ITEM A', qty: 30, sapQty: 30 },
      { obd: 'OBD-P7', obdDate: '2026-08-16', vehicle: 'HR01AA0001', date: '2026-08-16', sku: 'SKU-A', month: '08/26', bin: 'FG02', name: 'ITEM A', qty: 10, sapQty: 30 }
    ]
  });
  assert.equal(result.status, 'DONE');
  assert.equal(result.saved, 2);
  assert.equal(result.misRows, 1);
  assert.equal(ok.state.stock.find(r => r.id === 1).qty, 130);
  assert.equal(ok.state.mis[0].recvQty, 40);
  assert.equal(ok.state.mis[0].sapQty, 30);
  assert.equal(ok.state.mis[0].shortExcess, 10);
  assert.equal(ok.state.mis[0].status, 'EXCESS');
  assert.equal(ok.state.committed, true);
  assert.equal(ok.state.rolledBack, false);
  assert.equal(ok.state.released, true);

  // Downstream failure rolls back all SQL mutations; this is stricter than GAS's
  // sheet-by-sheet persistence but is the safe transactional boundary for SQL.
  const bad = makeDb({ failInsert: true });
  const failure = await batchInwardWithMIS({
    db: bad.db,
    mapping,
    lines: [{ obd: 'OBD-P7-FAIL', sku: 'SKU-A', month: '08/26', bin: 'FG01', qty: 5, sapQty: 5 }]
  });
  assert.equal(failure.status, 'ERROR');
  assert.equal(failure.transaction, 'ROLLED_BACK');
  assert.equal(bad.state.stock[0].qty, 100);
  assert.equal(bad.state.mis.length, 0);
  assert.equal(bad.state.committed, false);
  assert.equal(bad.state.rolledBack, true);
  assert.equal(bad.state.released, true);

  console.log('Phase 7A inward parity harness: PASS');
})();
