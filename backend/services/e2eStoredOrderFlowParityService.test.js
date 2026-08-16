const assert = require('assert');
const { runE2EStoredOrderFlow } = require('./e2eStoredOrderFlowParityService');

const result = runE2EStoredOrderFlow({
  warehouse: 'BB04',
  registerRows: [{
    warehouse:'BB04', soNumber:'SO1001', partyName:'TEST PARTY', destCity:'DELHI',
    obd:'800001', pgi:'900001', vehicle:'HR01AB1234', driver:'9999999999', boxes:10,
    contractor:'TEST CONTRACTOR', supervisor:'TEST SUPERVISOR', operator:'TEST OP',
    dispatchStatus:'DISPATCHED', dispatchedAt:'2026-08-16 12:00:00'
  }],
  orders: [{
    soNumber:'SO1001',
    lines:[
      {sku:'SKU-A', qty:80, desc:'A'},
      {sku:'SKU-B', qty:30, desc:'B'}
    ],
    remark:'', pgi:'900001'
  }],
  dumpRows: [
    {rowIndex:2, warehouse:'BB04', sloc:'FG01', material:'SKU-A', desc:'A', batches:[{batch:'B001',qty:50},{batch:'B002',qty:50}], totalUnrestricted:100, totalTransit:0},
    {rowIndex:3, warehouse:'BB04', sloc:'FG02', material:'SKU-B', desc:'B', batches:[{batch:'B003',qty:20}], totalUnrestricted:20, totalTransit:10}
  ],
  timestamp:'2026-08-16 12:05:00'
});

assert.strictEqual(result.status, 'DONE');
assert.strictEqual(result.selectedCount, 1);
assert.strictEqual(result.rejected.length, 0);
assert.strictEqual(result.orderUpdates.length, 1);
assert.strictEqual(result.orderUpdates[0].status, 'PARTIAL');
assert.deepStrictEqual(result.orderUpdates[0].clearLines, [
  {sku:'SKU-A',qty:80,desc:'A'},
  {sku:'SKU-B',qty:20,desc:'B'}
]);
assert.strictEqual(result.finalDumpRows[0].totalUnrestricted, 20);
assert.strictEqual(result.finalDumpRows[1].totalUnrestricted, 0);
assert.strictEqual(result.invariants.noNegativeStock, true);
assert.strictEqual(result.invariants.allocatedNotAboveRequested, true);
assert.strictEqual(result.invariants.batchRemarkWritten, true);

const invalid = runE2EStoredOrderFlow({
  warehouse:'BB04',
  registerRows:[{warehouse:'BB04',soNumber:'SO1002',dispatchStatus:'PENDING'}],
  orders:[{soNumber:'SO1002',lines:[{sku:'SKU-A',qty:1}]}],
  dumpRows:[]
});
assert.strictEqual(invalid.selectedCount, 0);
assert.strictEqual(invalid.rejected.length, 1);

console.log('Phase 8F end-to-end stored-order flow parity: PASS');
