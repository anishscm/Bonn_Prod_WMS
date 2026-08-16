# Phase 8D — Stored-Order FIFO Batch Allocation Parity

## Gold-Master source

Source inspected from `Code_Prod_WMS(2).gs`, function `ocAllocateStoredOrders(warehouse, soNumbers, userId, isManualAllocation, pgi)`.

The production function is invoked by both the Manage Orders allocation action and the Batch Picking deduction action. The Manage Orders UI passes `isManualAllocation=true`; Batch Picking passes `false` and may pass a PGI. The UI explicitly describes the Batch Picking action as FIFO allocation and stock deduction. filecite references are kept in the migration review record rather than in repository code. 

## Verified behavior

1. Orders are processed in the supplied `soNumbers` order.
2. The active warehouse is normalized and the order must exist in the Dispatched/Outward Register for that warehouse.
3. An order whose allocation remark already contains `BATCH` is skipped with `ALREADY_ALLOCATED`.
4. Previous transactional rows are released using `ocDeletePartialOrder(soNum, false)` before recalculation.
5. Order lines are read from the stored JSON.
6. For every SKU, the function walks matching stock-dump rows in sheet order and batches in array order.
7. Each batch is consumed up to the remaining requested quantity; partially consumed batches remain with their reduced quantity.
8. A fully satisfied order is written to Orders; a short order is written to Partial Clear Orders plus Shortage in Partial Clear Orders.
9. Allocation remark is `FULL ALLOCATION` or `PARTIAL ALLOCATION`. Batch details are appended as ` - BATCH: SKU[batch(qty),...]` for automatic allocation and ` - BATCH` for manual allocation.
10. Existing `(Block)` is preserved in the remark.
11. PGI uses the order's existing PGI first, then the globally supplied PGI.
12. The DUMP is rewritten from the mutated in-memory stock; rows with no unrestricted quantity or no batches are omitted.

## Important distinction from Phase 8C

This operation is **batch deduction**, not the Order Checker inhand/transit allocation calculation. The Gold Master directly deducts `SAP_STK_DUMP` batch quantities and does not insert a new `SAP_STK_ALLOCATION` row during this function. Phase 8C therefore remains responsible for the Order Checker allocation persistence gate, while Phase 8D covers stored-order FIFO/batch deduction.

## Migration boundary

The current PostgreSQL schema has `wms.sap_stk_dump.batch_qty` as TEXT containing the batch JSON, so the FIFO calculation can be represented without a new table. However, the exact Gold-Master `DISPATCHED` sheet is not yet represented by a single PostgreSQL table with the same 17-column contract. Therefore Phase 8D implements and tests the exact FIFO calculation/state transition as a parity gate but does **not** enable a production SQL writer or claim end-to-end source-table parity.

## Safety

No production data is written by this phase. GAS remains the Gold Master.
