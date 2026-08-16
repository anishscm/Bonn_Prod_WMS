# Phase 9F — RPC parity status

Phase 9F does not invent new production RPC behavior. It consolidates the already verified Gold-Master parity gates and explicitly records which RPCs are safe to wire only after their underlying transaction contract is merged and tested.

## Verified parity gates already present in repository history

| RPC / flow | Evidence gate | Status |
|---|---|---|
| `ocResetAllocation(activeWarehouse)` | PR #4 / Phase 8A | Verified contract; production writer disabled |
| `ocDispatchOrder(...)` | PR #5 / Phase 8E dispatch-register contract | Verified completion contract; production writer disabled |
| `opConfirmOutboundDeductStock(payload)` | PR #2 / Phase 6E | Verified Gold-Master transaction semantics; production writer disabled |
| Stored-order FIFO flow | PR #6 / Phase 8F | Verified end-to-end parity harness; production writer disabled |
| `iwConfirmInboundObd22()` | PR #3 / Phase 7C | Verified transaction ordering/rollback contract; production writer disabled |

## Important separation

`opConfirmOutboundDeductStock()` and `opDeductBatchPickingAndMIS()` are different Gold-Master operations and must not be merged into one RPC implementation. The former updates Operation_Sheet/Outward_MIS, deducts the first compatible physical-stock row, deletes matching physical allocations, and records BIN_TXIN. The latter is the separate batch-picking flow that affects SAP_STK_DUMP and PGI/MIS state.

## Gate rule

A registry entry is not considered production-ready merely because its RPC name exists. It requires:

1. verified Gold-Master semantics;
2. deterministic parity tests;
3. PostgreSQL transaction/rollback coverage where applicable;
4. controlled GAS-vs-SQL comparison;
5. explicit production enablement review.

Until all five are true, the compatibility layer remains non-production/read-only.
