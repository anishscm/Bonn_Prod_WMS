const assert = require('node:assert/strict');
const {
  normalizeStockRow,
  normalizeAllocationRow,
  buildStockSnapshot,
  buildAllocationSnapshot
} = require('./stockAllocationCompatibilityService');

const stock = normalizeStockRow({
  warehouse: ' bb04 ',
  s_loc: 'FG03',
  material: ' sku001 ',
  material_description: 'Product 1',
  batch_qty: '10',
  total_unrestricted: '8',
  total_transit: '2'
});
assert.deepEqual(stock, {
  warehouse: 'BB04', s_loc: 'FG03', material: 'SKU001',
  material_description: 'Product 1', batch_qty: 10,
  total_unrestricted: 8, total_transit: 2
});

const allocation = normalizeAllocationRow({
  warehouse: ' bb04 ', so_number: ' so1001 ', sku: ' sku001 ',
  inhand_alloc: '5', transit_alloc: '3'
});
assert.deepEqual(allocation, {
  warehouse: 'BB04', so_number: 'SO1001', sku: 'SKU001',
  inhand_alloc: 5, transit_alloc: 3
});

assert.equal(buildStockSnapshot([stock])[0].material, 'SKU001');
assert.equal(buildAllocationSnapshot([allocation])[0].so_number, 'SO1001');

console.log('Phase 9D stock/allocation compatibility tests: PASS');
