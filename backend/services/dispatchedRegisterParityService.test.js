const assert = require('assert');
const {
  REGISTER_FIELDS,
  normalizeDispatchRecord,
  mapDispatchList,
  buildDispatchCompletion
} = require('./dispatchedRegisterParityService');

assert.strictEqual(REGISTER_FIELDS.length, 17);

{
  const r = normalizeDispatchRecord({
    soNumber: '789012',
    party: 'BONN GROCERY HUB',
    dest: 'JALANDHAR',
    soDate: '2026-06-15',
    soTime: '11:00',
    submitTime: '15-Jun-2026 11:15',
    obd: '87654321',
    pgi: '1234567890',
    totalQty: 200,
    dispatchStatus: 'PENDING'
  }, 'BB04');
  assert.strictEqual(r.status, 'DONE');
  assert.strictEqual(r.row.warehouse, 'BB04');
  assert.strictEqual(r.row.so_number, '789012');
  assert.strictEqual(r.row.total_boxes, 200);
  assert.strictEqual(r.row.dispatch_status, 'PENDING');
}

{
  const r = buildDispatchCompletion({
    soNumber: '789012',
    party: 'BONN GROCERY HUB',
    dest: 'JALANDHAR',
    soDate: '2026-06-15',
    soTime: '11:00',
    submitTime: '15-Jun-2026 11:15',
    obd: '87654321',
    pgi: '1234567890',
    vehNumber: 'PB10AB1234',
    driverContact: '9876543210',
    totalBoxes: 200,
    contractorName: 'Contractor A',
    supervisorName: 'Supervisor A',
    operatorName: 'Operator A',
    dispatchedAt: '16-Aug-2026 12:00'
  }, 'BB04');
  assert.strictEqual(r.status, 'DONE');
  assert.strictEqual(r.row.dispatch_status, 'DISPATCHED');
  assert.strictEqual(r.row.obd, '87654321');
  assert.strictEqual(r.row.pgi, '1234567890');
  assert.strictEqual(r.row.total_boxes, 200);
  assert.strictEqual(r.row.dispatched_at, '16-Aug-2026 12:00');
}

{
  const r = buildDispatchCompletion({
    soNumber: '789012', obd: '123', pgi: '1234567890', vehNumber: 'PB10AB1234',
    driverContact: '9876543210', totalBoxes: 1, contractorName: 'C', supervisorName: 'S'
  }, 'BB04');
  assert.strictEqual(r.status, 'INVALID_OBD');
}

{
  const rows = mapDispatchList([
    {soNumber:'111111',dispatchStatus:'PENDING'},
    {soNumber:'222222',dispatchStatus:'DISPATCHED'}
  ], 'BB04');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].row.dispatch_status, 'PENDING');
  assert.strictEqual(rows[1].row.dispatch_status, 'DISPATCHED');
}

console.log('Phase 8E dispatched-register mapping parity tests: PASS');
