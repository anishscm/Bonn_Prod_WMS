#!/usr/bin/env node
/**
 * Phase 6E — deterministic GAS-vs-SQL outbound comparator.
 *
 * Usage:
 *   node tests/phase6/compare_outbound_capture.js gas.json sql.json
 *
 * Both files must contain:
 * {
 *   "response": { ... },
 *   "post_operation_state": {
 *      "phy_stk_entry": [...],
 *      "phy_stk_allocation": [...],
 *      "bin_txin": [...],
 *      "sap_stk_dump": [...],
 *      "operation_sheet": [...],
 *      "outward_mis": [...]
 *   }
 * }
 *
 * The comparator intentionally does not invent business mappings. It compares
 * the captured response and the supplied post-operation snapshots after
 * deterministic normalization (trimmed strings, stable key ordering and row
 * ordering). A PASS means the supplied captures are equivalent under that
 * normalization; it does not mean production cutover is approved by itself.
 */

const fs = require('fs');

const ENTITIES = [
  'phy_stk_entry',
  'phy_stk_allocation',
  'bin_txin',
  'sap_stk_dump',
  'operation_sheet',
  'outward_mis'
];

function load(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function scalar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim();
  return v;
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = normalize(value[key]);
      return out;
    }, {});
  }
  return scalar(value);
}

function diff(label, left, right) {
  const a = JSON.stringify(normalize(left));
  const b = JSON.stringify(normalize(right));
  return a === b ? null : `${label} differs`;
}

function assertShape(name, capture) {
  if (!capture || typeof capture !== 'object') throw new Error(`${name} capture must be an object`);
  if (!Object.prototype.hasOwnProperty.call(capture, 'response')) throw new Error(`${name}.response is missing`);
  if (!capture.post_operation_state || typeof capture.post_operation_state !== 'object') {
    throw new Error(`${name}.post_operation_state is missing`);
  }
  for (const entity of ENTITIES) {
    if (!Array.isArray(capture.post_operation_state[entity])) {
      throw new Error(`${name}.post_operation_state.${entity} must be an array`);
    }
  }
}

function main() {
  const [gasPath, sqlPath] = process.argv.slice(2);
  if (!gasPath || !sqlPath) {
    console.error('Usage: node tests/phase6/compare_outbound_capture.js gas.json sql.json');
    process.exit(2);
  }

  const gas = load(gasPath);
  const sql = load(sqlPath);
  assertShape('GAS', gas);
  assertShape('SQL', sql);

  const mismatches = [];
  const responseMismatch = diff('response', gas.response, sql.response);
  if (responseMismatch) mismatches.push(responseMismatch);

  for (const entity of ENTITIES) {
    const mismatch = diff(`post_operation_state.${entity}`, gas.post_operation_state[entity], sql.post_operation_state[entity]);
    if (mismatch) mismatches.push(mismatch);
  }

  const result = {
    status: mismatches.length ? 'FAIL' : 'PASS',
    compared: {
      response: true,
      post_operation_state: ENTITIES
    },
    mismatches
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(mismatches.length ? 1 : 0);
}

main();
