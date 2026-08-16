/**
 * Phase 9G — controlled GAS-vs-SQL comparison harness.
 *
 * This module is deliberately adapter-only. It never connects to GAS,
 * Supabase, PostgreSQL, or production data by itself. Callers must inject
 * deterministic adapters that return a response and a post-operation state.
 *
 * The harness compares the two captures in two independent dimensions:
 *   1. RPC/function response parity
 *   2. Post-operation state parity
 *
 * This keeps transport differences out of the parity decision and makes
 * mismatches deterministic and reviewable before any production writer is
 * enabled.
 */

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
}

function deepEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function diffValues(left, right, path = '$', diffs = []) {
  if (deepEqual(left, right)) return diffs;

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      diffValues(left[i], right[i], `${path}[${i}]`, diffs);
    }
    return diffs;
  }

  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    [...keys].sort().forEach((key) => {
      if (!(key in left)) {
        diffs.push({ path: `${path}.${key}`, gas: undefined, sql: right[key], type: 'MISSING_IN_GAS' });
      } else if (!(key in right)) {
        diffs.push({ path: `${path}.${key}`, gas: left[key], sql: undefined, type: 'MISSING_IN_SQL' });
      } else {
        diffValues(left[key], right[key], `${path}.${key}`, diffs);
      }
    });
    return diffs;
  }

  diffs.push({ path, gas: left, sql: right, type: 'VALUE_MISMATCH' });
  return diffs;
}

function assertCapture(capture, label) {
  if (!isObject(capture)) throw new Error(`${label} capture must be an object`);
  if (!('response' in capture)) throw new Error(`${label} capture.response is required`);
  if (!('state' in capture)) throw new Error(`${label} capture.state is required`);
}

function compareCaptures(gasCapture, sqlCapture) {
  assertCapture(gasCapture, 'GAS');
  assertCapture(sqlCapture, 'SQL');

  const responseDiffs = diffValues(gasCapture.response, sqlCapture.response);
  const stateDiffs = diffValues(gasCapture.state, sqlCapture.state);

  return {
    matched: responseDiffs.length === 0 && stateDiffs.length === 0,
    responseMatched: responseDiffs.length === 0,
    stateMatched: stateDiffs.length === 0,
    responseDiffs,
    stateDiffs,
  };
}

async function runControlledComparison({ gasAdapter, sqlAdapter, input }) {
  if (typeof gasAdapter !== 'function') throw new Error('gasAdapter must be a function');
  if (typeof sqlAdapter !== 'function') throw new Error('sqlAdapter must be a function');

  const gasCapture = await gasAdapter(input);
  const sqlCapture = await sqlAdapter(input);
  const comparison = compareCaptures(gasCapture, sqlCapture);

  return {
    input,
    gas: gasCapture,
    sql: sqlCapture,
    comparison,
  };
}

module.exports = {
  canonicalize,
  deepEqual,
  diffValues,
  compareCaptures,
  runControlledComparison,
};
