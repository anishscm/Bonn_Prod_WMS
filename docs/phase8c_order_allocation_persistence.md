# Phase 8C — Order Allocation Persistence Parity

## Gold-Master source

This gate is mapped from the production GAS functions:

- `ocSubmitClearOrder`
- `ocSubmitPartialOrder`
- `ocDeletePartialOrder`
- `_buildRawStockMap`
- `_buildAllocMap`
- `_allocateLines`

The Gold Master first detects an existing order, releases the old order state when updating, rebuilds running stock from raw SAP dump minus existing allocations, allocates inhand first and transit second, then writes the order/allocation records.

## SQL persistence mapping

| Gold-Master store | PostgreSQL table |
|---|---|
| `SAP_STK_ALLOCATION` | `wms.sap_stk_allocation` |
| Partial Clear Orders | `wms.partial_clear_orders` |
| Shortage in Partial Clear Orders | `wms.shortage_partial_orders` |
| Orders / Clear Order | `wms.clear_order` |
| Outward / Order Checker | `wms.order_checker` |

### Clear order

`ocSubmitClearOrder` allocates every submitted line, writes allocation rows, writes one `clear_order` record, and writes one `order_checker` record. If transit is used, the Gold Master reports `Full Allocation (Transit)` and uses transit quantity in the shortage/remark fields.

### Partial order

`ocSubmitPartialOrder` converts each clear line to its requested quantity and each short line to `availInhand + trnUsed` for allocation. It writes allocation rows, one partial-clear record, one shortage record per short line, and one order-checker record. The order-checker shortage quantity is the accumulated Short-BT quantity; its shortage remark is blank.

### Update / release

`ocDeletePartialOrder(so,true)` removes the SO from Partial Clear Orders, Shortage Partial Orders, SAP_STK_ALLOCATION, Orders/Clear Order, and the Outward Register. Phase 8C performs the same five-table SQL cleanup inside the same transaction before rebuilding the order.

## Transaction safety

Every multi-table submit uses one PostgreSQL transaction. Any failure rolls back allocation rows and all order/shortage records together. No production cutover is enabled by this phase.

## SO number representation

Google Sheets uses a leading apostrophe in `setValues()` to force text display, but the underlying cell value is the numeric/text SO without that display marker. PostgreSQL therefore stores the normalized SO number without a literal leading apostrophe.

## Scope boundary

This gate covers persistence and release semantics. It does not change the production GAS Gold Master and does not perform a live production data migration.
