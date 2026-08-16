const assert = require('assert');
const stock = require('../backend/services/stockCompatibilityService');
const allocation = require('../backend/services/allocationCompatibilityService');
const orders = require('../backend/services/orderCompatibilityService');
const outbound = require('../backend/services/outboundCompatibilityService');
const inbound = require('../backend/services/inboundInventoryCompatibilityService');
const audit = require('../backend/services/auditCciCompatibilityService');

const stockRows = [
  { id: 2, warehouse: 'BB04', s_loc: 'FG01', material: 'SKU1', total_unrestricted: 10, total_transit: 5 },
  { id: 1, warehouse: 'BB04', s_loc: 'FG01', material: 'SKU1', total_unrestricted: 20, total_transit: 0 }
];

assert.equal(stock.buildStockLookup(stockRows, 'bb04', 'sku1').length, 2);

const allocRows = [
  { warehouse: 'BB04', so_number: 'SO1', sku: 'SKU1', inhand_alloc: 20, transit_alloc: 5 }
];
assert.deepStrictEqual(allocation.allocationTotals(allocRows, 'so1', 'sku1'), {
  inhand_alloc: 20,
  transit_alloc: 5
});
assert.equal(allocation.resetAllocationRows(allocRows, 'SO1').length, 0);

assert.equal(orders.calculateShortage(100, 70), 30);
assert.deepStrictEqual(orders.classifyAllocation(100, 100), { status: 'OK', shortage_qty: 0 });
assert.deepStrictEqual(orders.classifyAllocation(100, 70), { status: 'PARTIAL', shortage_qty: 30 });
assert.deepStrictEqual(orders.classifyAllocation(100, 0), { status: 'SHORT', shortage_qty: 100 });

const physical = [
  { id: 2, mfg_month: '2026-02', bin: 'B02', sku: 'SKU1', qty: 50 },
  { id: 1, mfg_month: '2026-01', bin: 'B01', sku: 'SKU1', qty: 30 }
];
const picked = outbound.allocateFifo(physical, 60);
assert.equal(picked.allocated_qty, 60);
assert.equal(picked.shortage_qty, 0);
assert.deepStrictEqual(picked.allocations.map(x => x.mfg_month), ['2026-01', '2026-02']);
assert.equal(outbound.validateDeduction(physical[0], 20), 30);
assert.throws(() => outbound.validateDeduction(physical[0], 100));

assert.equal(inbound.calculateShortExcess(100, 103), 3);
assert.equal(inbound.calculateShortExcess(100, 97), -3);
assert.equal(inbound.consolidatePhysicalEntry([
  { mfg_month: '2026-01', bin: 'B01', sku: 'SKU1', qty: 10 },
  { mfg_month: '2026-01', bin: 'B01', sku: 'SKU1', qty: 5 },
  { mfg_month: '2026-02', bin: 'B01', sku: 'SKU1', qty: 9 }
], '2026-01', 'b01', 'sku1'), 15);

assert.deepStrictEqual(audit.classifyCciVariance(100, 100), { status: 'MATCH', variance: 0 });
assert.deepStrictEqual(audit.classifyCciVariance(100, 97), { status: 'SHORT', variance: -3 });
assert.deepStrictEqual(audit.classifyCciVariance(100, 103), { status: 'EXCESS', variance: 3 });
assert.equal(audit.buildBinTransaction({ warehouse: 'BB04', bin: 'B01', sku: 'SKU1', qty: -5, transactionType: 'OUT' }).qty, -5);

console.log('Phase 9E compatibility suite: PASS');
