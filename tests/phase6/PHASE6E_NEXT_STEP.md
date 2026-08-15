# Phase 6E — Next Step

The implementation and disposable SQL tests are complete. The remaining gate is an actual Gold-Master GAS capture.

## Controlled test only
Use a disposable/test SKU, SO and OBD. Do not use a live customer order or live stock.

Suggested fixture:
- Warehouse: BB04
- SO: TEST-SO-P6
- OBD: 12345678
- SKU: TEST-SKU-P6
- BIN: TEST-FG01
- MFG: 2026-08
- Requested: 10
- Seed physical stock: 100
- Seed physical allocation: 20

## Required GAS capture
Execute the existing GAS outbound confirmation flow and save:
1. exact return object/message
2. affected post-operation rows from:
   - phy_stk_entry
   - phy_stk_allocation
   - bin_txin
   - sap_stk_dump
   - operation_sheet
   - outward_mis

Do not expose unrelated production records.

## Why this is required
The PostgreSQL implementation is intentionally not marked production-equivalent based only on unit tests. The final parity gate compares GAS response and six post-operation states against the SQL run from the same starting state.

Follow `OUTBOUND_GAS_CAPTURE_RUNBOOK.md` for the exact capture/compare procedure.

## Cutover rule
No merge to `main` and no production cutover until:
- normal outbound scenario = PASS
- shortage/rollback scenario = PASS
