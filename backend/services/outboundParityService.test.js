const assert = require('node:assert/strict');
const {
  norm,
  cleanBin,
  cleanSku,
  assertProductionMapping
} = require('./outboundParityService');

assert.equal(norm(' bb04 '), 'BB04');
assert.equal(cleanBin('BIN-FG-03'), 'FG03');
assert.equal(cleanSku(' sku-001 / a '), 'SKU001A');

const verifiedMapping = {
  phyStock: {
    schema: 'wms', table: 'phy_stk_entry', id: 'id', qty: 'qty',
    plant: 'plant', sku: 'sku', bin: 'bin', mfg: 'mfg_month', updatedAt: 'updated_at'
  },
  phyAllocation: {
    schema: 'wms', table: 'phy_stk_allocation', warehouse: 'warehouse', so: 'so_number'
  },
  binTx: {
    schema: 'wms', table: 'bin_txin', warehouse: 'warehouse', timestamp: 'event_timestamp',
    bin: 'bin', sku: 'sku', qty: 'qty', mfg: 'batch', type: 'transaction_type',
    reference: 'doc_number', username: 'user_id'
  },
  sapDump: { deduct: async () => {} },
  operationSheet: { update: async () => {} },
  outwardMis: { append: async () => {} }
};

assert.doesNotThrow(() => assertProductionMapping(verifiedMapping));
assert.throws(
  () => assertProductionMapping({ ...verifiedMapping, sapDump: {} }),
  /Incomplete production mapping: sapDump\.deduct/
);

console.log('Phase 6E outbound mapping gate tests: PASS');
