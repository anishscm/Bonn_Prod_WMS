const assert = require('node:assert/strict');
const {
  compareCaptures,
  diffValues,
  runControlledComparison,
} = require('./gasSqlControlledComparisonService');

async function main() {
  const matching = compareCaptures(
    { response: { status: 'DONE', count: 2 }, state: { rows: [{ b: 2, a: 1 }] } },
    { response: { count: 2, status: 'DONE' }, state: { rows: [{ a: 1, b: 2 }] } }
  );
  assert.equal(matching.matched, true);
  assert.deepEqual(matching.responseDiffs, []);
  assert.deepEqual(matching.stateDiffs, []);

  const mismatching = compareCaptures(
    { response: { status: 'DONE' }, state: { stock: 8 } },
    { response: { status: 'ERROR' }, state: { stock: 7 } }
  );
  assert.equal(mismatching.matched, false);
  assert.equal(mismatching.responseMatched, false);
  assert.equal(mismatching.stateMatched, false);
  assert.equal(mismatching.responseDiffs[0].path, '$.status');
  assert.equal(mismatching.stateDiffs[0].path, '$.stock');

  const missing = diffValues({ stock: 10 }, { stock: 10, allocation: 2 });
  assert.deepEqual(missing, [
    { path: '$.allocation', gas: undefined, sql: 2, type: 'MISSING_IN_GAS' },
  ]);

  const calls = [];
  const controlled = await runControlledComparison({
    input: { so: 'SO-TEST-001' },
    gasAdapter: async (input) => {
      calls.push(['gas', input]);
      return { response: { status: 'DONE' }, state: { stock: 9 } };
    },
    sqlAdapter: async (input) => {
      calls.push(['sql', input]);
      return { response: { status: 'DONE' }, state: { stock: 9 } };
    },
  });
  assert.equal(controlled.comparison.matched, true);
  assert.deepEqual(calls.map(([name]) => name), ['gas', 'sql']);

  assert.throws(
    () => compareCaptures({ response: {} }, { response: {}, state: {} }),
    /GAS capture\.state is required/
  );

  console.log('Phase 9G controlled comparison tests: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
