# Phase 8B — Order Allocation Calculation Parity

## Source of truth
The production `Index_Prod_WMS(2).html` contains the verified calculation used by the Order Checker before `ocSubmitPartialOrder(...)` / `ocSubmitClearOrder(...)`.

## Verified calculation
For each order line:

1. `inhAllocThis = min(availInhand, requestedQty)`
2. `shortBT = max(0, requestedQty - inhAllocThis)`
3. `statusBT = OK` when `shortBT = 0`; otherwise `NO STOCK` when `availInhand = 0`, else `SHORT`
4. `transitAvailable = max(0, availTotal - availInhand)`
5. `trnUsed = min(transitAvailable, shortBT)`
6. `shortAT = max(0, shortBT - trnUsed)`
7. `statusAT = OK` when `shortAT = 0`; otherwise `NO STOCK` when `availTotal = 0`, else `SHORT`

These formulas are directly reflected in the production frontend calculation.

## Output contract
The parity service preserves the frontend fields:

- SKU / description
- requested quantity
- SAP stock
- transit stock
- existing inhand allocation
- existing transit allocation
- available inhand
- available total
- this-order inhand allocation
- Short BT / Status BT
- Transit Used
- Short AT / Status AT

## Scope boundary
This gate validates only the calculation semantics. It does **not** claim the complete Gold-Master persistence semantics of `ocSubmitPartialOrder`, `ocSubmitClearOrder`, `ocAllocateStoredOrders`, or allocation release.

Those operations have multi-sheet side effects and must be mapped from the exact production GAS backend before SQL writes are enabled.

## Safety
No production Supabase writes are performed by this phase. GAS remains the Gold Master.
