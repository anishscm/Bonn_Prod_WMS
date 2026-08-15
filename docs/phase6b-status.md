# Phase 6B Status — Inventory Transaction Parity

## Completed

- Isolated outbound transaction service added under `backend/services/outboundParityService.js`.
- Service uses a PostgreSQL transaction (`BEGIN` / `COMMIT` / `ROLLBACK`).
- Physical-stock rows are locked with `FOR UPDATE` before deduction.
- Insufficient stock causes rollback instead of partial deduction.
- Physical allocation deletion and BIN transaction logging are included as explicit side-effects.
- Operation Sheet and Outward MIS writes are injected behind explicit mapping callbacks; this prevents guessed column contracts.
- Basic normalization unit tests added.

## Not yet production-ready

The service is intentionally not wired into the live RPC router. Exact SQL column mappings for Operation Sheet, Outward MIS, and the remaining Gold Master side-effects still require GAS-vs-SQL parity fixtures.

The current GAS WMS remains the Gold Master / rollback system.

## Next test sequence

1. Create disposable test rows only.
2. Run one outbound line through GAS and capture response + post-operation sheet state.
3. Run the same input through SQL service and capture response + post-operation DB state.
4. Compare physical stock, allocation, BIN_TXIN, Operation Sheet and Outward MIS.
5. Repeat for split-batch and insufficient-stock cases.
6. Run two concurrent deductions against the same stock row and verify no double deduction/negative stock.
7. Only after all tests pass should the service be connected to the RPC adapter.
