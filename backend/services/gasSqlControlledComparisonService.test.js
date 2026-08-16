const {
  compareCaptures,
  diffValues,
  runControlledComparison,
} = require('./gasSqlControlledComparisonService');

describe('Phase 9G controlled GAS-vs-SQL comparison', () => {
  test('matches object key order differences', () => {
    const result = compareCaptures(
      { response: { status: 'DONE', count: 2 }, state: { rows: [{ b: 2, a: 1 }] } },
      { response: { count: 2, status: 'DONE' }, state: { rows: [{ a: 1, b: 2 }] } }
    );

    expect(result.matched).toBe(true);
    expect(result.responseDiffs).toEqual([]);
    expect(result.stateDiffs).toEqual([]);
  });

  test('separates response mismatch from state mismatch', () => {
    const result = compareCaptures(
      { response: { status: 'DONE' }, state: { stock: 8 } },
      { response: { status: 'ERROR' }, state: { stock: 7 } }
    );

    expect(result.matched).toBe(false);
    expect(result.responseMatched).toBe(false);
    expect(result.stateMatched).toBe(false);
    expect(result.responseDiffs[0].path).toBe('$.status');
    expect(result.stateDiffs[0].path).toBe('$.stock');
  });

  test('reports missing keys deterministically', () => {
    const diffs = diffValues(
      { stock: 10 },
      { stock: 10, allocation: 2 }
    );

    expect(diffs).toEqual([
      { path: '$.allocation', gas: undefined, sql: 2, type: 'MISSING_IN_GAS' },
    ]);
  });

  test('runs injected adapters without enabling a production writer', async () => {
    const calls = [];
    const result = await runControlledComparison({
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

    expect(result.comparison.matched).toBe(true);
    expect(calls.map(([name]) => name)).toEqual(['gas', 'sql']);
  });

  test('fails fast for malformed captures', () => {
    expect(() => compareCaptures({ response: {} }, { response: {}, state: {} }))
      .toThrow('GAS capture.state is required');
  });
});
