# Phase 6 disposable parity tests

These tests are designed for a disposable PostgreSQL database only. They must not be run against the production Supabase database.

## Test 1 — outbound deduction

Seed:
- SKU: `TEST-SKU-P6`
- Bin: `TEST-FG01`
- Warehouse/plant: `BB04`
- Physical quantity: 100
- Allocation: 20

Expected transaction contract:
- requested deduction: 10
- physical quantity becomes 90
- allocation changes only according to the exact Gold Master rule
- one matching `bin_txin` movement is written
- all related writes commit together
- any failure rolls the complete transaction back

## Test 2 — insufficient stock

Attempt a deduction greater than the locked available physical quantity.
Expected: error and zero persistent changes.

## Test 3 — concurrent deduction

Run two deductions against the same SKU/bin/MFG concurrently.
Expected: row locking prevents double-spend/negative stock and both operations
observe a serializable stock state.

## Test 4 — GAS parity

For each scenario capture:
1. GAS response
2. GAS post-operation sheet state
3. SQL response
4. SQL post-operation database state

Do not declare PASS from response-only comparison.
