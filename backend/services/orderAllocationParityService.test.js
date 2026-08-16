const assert = require('assert');
const {
  calculateOrderLineAllocation,
  calculateOrderAllocation
} = require('./orderAllocationParityService');

function testFullInhand() {
  const r = calculateOrderLineAllocation(
    { sku: 'AC138', qty: 100 },
    { sap: 1500, transit: 100, inhAlloc: 100, trnAlloc: 10, availInhand: 1400, availTotal: 1490 }
  );
  assert.strictEqual(r.inhAllocThis, 100);
  assert.strictEqual(r.shortBT, 0);
  assert.strictEqual(r.statusBT, 'OK');
  assert.strictEqual(r.trnUsed, 0);
  assert.strictEqual(r.shortAT, 0);
  assert.strictEqual(r.statusAT, 'OK');
}

function testInhandShortButTransitCovers() {
  const r = calculateOrderLineAllocation(
    { sku: 'AC200', qty: 800 },
    { sap: 800, transit: 100, inhAlloc: 0, trnAlloc: 0, availInhand: 500, availTotal: 800 }
  );
  assert.strictEqual(r.inhAllocThis, 500);
  assert.strictEqual(r.shortBT, 300);
  assert.strictEqual(r.statusBT, 'SHORT');
  assert.strictEqual(r.trnUsed, 300);
  assert.strictEqual(r.shortAT, 0);
  assert.strictEqual(r.statusAT, 'OK');
}

function testCriticalAfterTransitShortage() {
  const r = calculateOrderLineAllocation(
    { sku: 'AC300', qty: 900 },
    { sap: 500, transit: 100, availInhand: 400, availTotal: 500 }
  );
  assert.strictEqual(r.inhAllocThis, 400);
  assert.strictEqual(r.shortBT, 500);
  assert.strictEqual(r.statusBT, 'SHORT');
  assert.strictEqual(r.trnUsed, 100);
  assert.strictEqual(r.shortAT, 400);
  assert.strictEqual(r.statusAT, 'SHORT');
}

function testNoStock() {
  const r = calculateOrderLineAllocation(
    { sku: 'AC400', qty: 50 },
    { sap: 0, transit: 0, availInhand: 0, availTotal: 0 }
  );
  assert.strictEqual(r.inhAllocThis, 0);
  assert.strictEqual(r.shortBT, 50);
  assert.strictEqual(r.statusBT, 'NO STOCK');
  assert.strictEqual(r.trnUsed, 0);
  assert.strictEqual(r.shortAT, 50);
  assert.strictEqual(r.statusAT, 'NO STOCK');
}

function testTransitCannotExceedBeforeTransitShortage() {
  const r = calculateOrderLineAllocation(
    { sku: 'AC500', qty: 100 },
    { availInhand: 80, availTotal: 500, transit: 420 }
  );
  assert.strictEqual(r.shortBT, 20);
  assert.strictEqual(r.trnUsed, 20);
  assert.strictEqual(r.shortAT, 0);
  assert.strictEqual(r.statusAT, 'OK');
}

function testOrderBatch() {
  const rows = calculateOrderAllocation(
    [
      { sku: 'AC1', qty: 10 },
      { sku: 'AC2', qty: 20 }
    ],
    {
      AC1: { availInhand: 10, availTotal: 10 },
      AC2: { availInhand: 5, availTotal: 15 }
    }
  );
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].statusBT, 'OK');
  assert.strictEqual(rows[1].shortBT, 15);
  assert.strictEqual(rows[1].trnUsed, 10);
  assert.strictEqual(rows[1].shortAT, 5);
  assert.strictEqual(rows[1].statusAT, 'SHORT');
}

testFullInhand();
testInhandShortButTransitCovers();
testCriticalAfterTransitShortage();
testNoStock();
testTransitCannotExceedBeforeTransitShortage();
testOrderBatch();

console.log('Phase 8B order-allocation calculation parity tests: PASS');
