const assert = require('node:assert/strict');
const { norm, cleanBin, cleanSku } = require('./outboundParityService');

assert.equal(norm(' bb04 '), 'BB04');
assert.equal(cleanBin('BIN-FG-03'), 'FG03');
assert.equal(cleanSku(' sku-001 / a '), 'SKU001A');

console.log('Phase 6B outbound normalization tests: PASS');
