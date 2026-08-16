const assert = require('node:assert/strict');
const { confirmInboundObd22, validatePayload, buildLogicalItems } = require('./inboundConfirmationParityService');

function makeDb() {
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql); },
    release() { calls.push('RELEASE'); }
  };
  return {
    calls,
    async connect() { return client; }
  };
}

function adapters(events, failAt = '') {
  const make = name => ({
    async apply(client, ctx) {
      events.push(name);
      if (failAt === name) throw new Error(`${name} failed`);
      assert.equal(ctx.obd, 'OBD-7C-001');
      assert.equal(ctx.items.length, 2);
    }
  });
  return {
    inwardMis: make('INWARD_MIS'),
    sapDump: make('SAP_STK_DUMP'),
    phyStock: make('PHY_STK_ENTRY'),
    binTxin: make('BIN_TXIN')
  };
}

(async () => {
  assert.equal(validatePayload(null), 'OBD is required');
  assert.equal(validatePayload({ obd: 'OBD-1', items: [] }), 'items are required');
  assert.equal(validatePayload({ obd: 'OBD-1', items: [{ sku: 'SKU-1', phyQty: 10 }] }), 'items[0].bin is required when physical quantity is greater than zero');

  const payload = {
    obd: 'obd-7c-001',
    supervisorName: 'SUP-1',
    contractorName: 'CON-1',
    startTime: '10:00',
    endTime: '11:00',
    dockNum: 'D1',
    shift: 'A',
    unloadingDate: '2026-08-16',
    grn: 'GRN-1',
    warehouse: 'WH01',
    activeUser: 'user1',
    items: [
      { rowIndex: 1, sku: 'sku-1', desc: 'Item 1', billedBatch: 'AUG26', phyBatch: 'AUG26', billQty: 100, phyQty: 100, bin: 'FG01' },
      { rowIndex: 2, sku: 'sku-2', desc: 'Item 2', billedBatch: 'AUG26', phyBatch: 'AUG26', billQty: 50, phyQty: 45, bin: 'FG02' }
    ]
  };

  const logical = buildLogicalItems(payload);
  assert.equal(logical[0].status, 'OK');
  assert.equal(logical[1].status, 'SHORT');
  assert.equal(logical[1].shortExcess, -5);

  const db = makeDb();
  const events = [];
  const result = await confirmInboundObd22({ db, adapters: adapters(events), payload });
  assert.equal(result.status, 'DONE');
  assert.equal(result.savedStock, 145);
  assert.deepEqual(events, ['INWARD_MIS', 'SAP_STK_DUMP', 'PHY_STK_ENTRY', 'BIN_TXIN']);
  assert.equal(db.calls[0], 'BEGIN');
  assert.equal(db.calls[1], 'COMMIT');

  const rollbackDb = makeDb();
  const rollbackEvents = [];
  const failed = await confirmInboundObd22({
    db: rollbackDb,
    adapters: adapters(rollbackEvents, 'PHY_STK_ENTRY'),
    payload
  });
  assert.equal(failed.status, 'ERROR');
  assert.equal(failed.transaction, 'ROLLED_BACK');
  assert.deepEqual(rollbackEvents, ['INWARD_MIS', 'SAP_STK_DUMP', 'PHY_STK_ENTRY']);
  assert.ok(rollbackDb.calls.includes('ROLLBACK'));

  console.log('Phase 7C inbound confirmation parity tests: PASS');
})();
