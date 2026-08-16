const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareCaptures } = require('../backend/services/gasSqlControlledComparisonService');

const fixturePath = path.join(__dirname, 'phase9h_outbound_fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

assert.equal(fixture.mode, 'CONTROLLED_NON_PRODUCTION');
assert.equal(fixture.production_write_enabled, false);
assert.equal(fixture.parity_status, 'NOT_CAPTURED');
assert.equal(fixture.gas_capture.captured, false);
assert.equal(fixture.sql_capture.captured, false);
assert.equal(fixture.input.warehouse, 'BB04');
assert.equal(fixture.input.requested_qty, 10);
assert.equal(fixture.seed_state.phy_stk_entry_qty, 100);
assert.equal(fixture.seed_state.phy_stk_allocation_qty, 20);

// Incomplete captures must never become a parity PASS. The harness accepts
// the capture shape, but the explicit captured flags keep the gate closed.
const comparison = compareCaptures(fixture.gas_capture, fixture.sql_capture);
assert.equal(comparison.matched, true);
assert.equal(fixture.gas_capture.captured, false);
assert.equal(fixture.sql_capture.captured, false);
assert.equal(fixture.parity_status, 'NOT_CAPTURED');

console.log('Phase 9H controlled fixture safety gate: PASS');
console.log('Phase 9H real GAS-vs-SQL capture: NOT CAPTURED');
