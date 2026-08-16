const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

// The fixture is intentionally a placeholder. CI verifies that it cannot be
// mistaken for a real parity capture; the real comparator is only meaningful
// after both captures contain response + post-operation state.
const hasCompleteCaptures =
  fixture.gas_capture.captured === true &&
  fixture.sql_capture.captured === true &&
  fixture.gas_capture.response !== null &&
  fixture.gas_capture.state !== null &&
  fixture.sql_capture.response !== null &&
  fixture.sql_capture.state !== null;

assert.equal(hasCompleteCaptures, false);
assert.notEqual(fixture.parity_status, 'PASS');

console.log('Phase 9H controlled fixture safety gate: PASS');
console.log('Phase 9H real GAS-vs-SQL capture: NOT CAPTURED');
