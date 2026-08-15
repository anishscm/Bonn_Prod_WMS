const assert = require('node:assert/strict');
const {
  confirmOutbound,
  norm,
  cleanBin,
  cleanSku,
  assertProductionMapping
} = require('./outboundParityService');

assert.equal(norm(' bb04 '), 'BB04');
assert.equal(cleanBin('BIN-FG-03'), 'FG03');
assert.equal(cleanSku(' sku-001 / a '), 'SKU001A');

const mapping = {
  phyStock: { schema: 'wms', table: 'phy_stk_entry', id: 'id', qty: 'qty', plant: 'plant', sku: 'sku', bin: 'bin', mfg: 'mfg_month', updatedAt: 'updated_at' },
  phyAllocation: { schema: 'wms', table: 'phy_stk_allocation', warehouse: 'warehouse', so: 'so_number' },
  binTx: { schema: 'wms', table: 'bin_txin', warehouse: 'warehouse', timestamp: 'event_timestamp', bin: 'bin', sku: 'sku', qty: 'qty', mfg: 'batch', type: 'transaction_type', reference: 'doc_number', username: 'user_id' },
  operationSheet: { update: async () => {} },
  outwardMis: { update: async () => {} }
};

assert.doesNotThrow(() => assertProductionMapping(mapping));

function makeDb({ failAdapter = false } = {}) {
  const calls = [];
  const state = {
    stock: [{ id: 1, qty: 60 }, { id: 2, qty: 50 }],
    allocationDeleted: false,
    binTx: 0,
    committed: false,
    rolledBack: false,
    released: false,
    adapters: { operation: 0, outward: 0 }
  };
  let snapshot = null;

  const cloneState = () => JSON.parse(JSON.stringify(state));
  const restoreState = (saved) => {
    state.stock = saved.stock;
    state.allocationDeleted = saved.allocationDeleted;
    state.binTx = saved.binTx;
    state.adapters = saved.adapters;
  };

  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (compact === 'BEGIN') { snapshot = cloneState(); return { rows: [] }; }
      if (compact === 'COMMIT') { state.committed = true; return { rows: [] }; }
      if (compact === 'ROLLBACK') {
        state.rolledBack = true;
        if (snapshot) restoreState(snapshot);
        return { rows: [] };
      }
      if (compact.startsWith('SELECT') && compact.includes('FOR UPDATE')) {
        // Gold Master opConfirmOutboundDeductStock uses the first matching row only.
        return { rows: state.stock.slice(0, 1).map(r => ({ id: r.id, qty: r.qty })) };
      }
      if (compact.startsWith('DELETE FROM "wms"."phy_stk_entry"')) {
        const id = params[0];
        const row = state.stock.find(r => r.id === id);
        if (row) row.qty = 0;
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE "wms"."phy_stk_entry"')) {
        const row = state.stock.find(r => r.id === params[1]);
        if (row) row.qty = Number(params[0]);
        return { rows: [] };
      }
      if (compact.startsWith('DELETE FROM "wms"."phy_stk_allocation"')) {
        state.allocationDeleted = true;
        return { rows: [], rowCount: 1 };
      }
      if (compact.startsWith('INSERT INTO "wms"."bin_txin"')) {
        state.binTx += 1;
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { state.released = true; }
  };

  const db = { async connect() { return client; } };
  const testMapping = {
    ...mapping,
    operationSheet: { update: async () => { state.adapters.operation += 1; if (failAdapter) throw new Error('OPERATION_ADAPTER_TEST_FAILURE'); } },
    outwardMis: { update: async () => { state.adapters.outward += 1; } }
  };
  return { db, state, calls, mapping: testMapping };
}

(async () => {
  // Gold Master parity: only the first matching physical row is deducted.
  const ok = makeDb();
  const success = await confirmOutbound({
    db: ok.db,
    mapping: ok.mapping,
    payload: {
      warehouse: 'BB04', plant: 'BB04', soNumber: 'SO-P6-001', obdNumber: '12345678', updatedBy: 'TEST',
      items: [{ sku: 'TEST-SKU-P6', bin: 'FG01', mfgMonth: '2026-08', allocatedQty: 100 }]
    }
  });
  assert.equal(success.status, 'SUCCESS');
  assert.equal(success.transaction, 'COMMITTED');
  assert.equal(ok.state.stock[0].qty, 0);
  assert.equal(ok.state.stock[1].qty, 50); // GAS does not roll into a second stock row.
  assert.equal(ok.state.allocationDeleted, true);
  assert.equal(ok.state.binTx, 1);
  assert.deepEqual(ok.state.adapters, { operation: 1, outward: 1 });
  assert.equal(ok.state.committed, true);
  assert.equal(ok.state.rolledBack, false);
  assert.equal(ok.state.released, true);

  // Failure after the first adapter write must rollback the DB transaction.
  const bad = makeDb({ failAdapter: true });
  const failure = await confirmOutbound({
    db: bad.db,
    mapping: bad.mapping,
    payload: {
      warehouse: 'BB04', plant: 'BB04', soNumber: 'SO-P6-002', obdNumber: '87654321', updatedBy: 'TEST',
      items: [{ sku: 'TEST-SKU-P6', bin: 'FG01', mfgMonth: '2026-08', allocatedQty: 10 }]
    }
  });
  assert.equal(failure.status, 'ERROR');
  assert.equal(failure.transaction, 'ROLLED_BACK');
  assert.deepEqual(bad.state.stock.map(r => r.qty), [60, 50]);
  assert.equal(bad.state.allocationDeleted, false);
  assert.equal(bad.state.binTx, 0);
  assert.deepEqual(bad.state.adapters, { operation: 0, outward: 0 });
  assert.equal(bad.state.committed, false);
  assert.equal(bad.state.rolledBack, true);
  assert.equal(bad.state.released, true);

  console.log('Phase 6E Gold-Master outbound confirm parity harness: PASS');
})();
