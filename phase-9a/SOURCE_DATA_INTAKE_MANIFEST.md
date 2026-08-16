# BONN WMS — Phase 9A Source Data Intake Manifest

## Status

Phase 9A is a source-discovery and intake phase only. No live production data is imported and no production cutover is authorized.

The current Google Apps Script / Google Sheets implementation remains the Gold Master until parity testing passes.

## Confirmed source sheets

| Source sheet | Role | Confirmed fields / behavior | SQL target |
|---|---|---|---|
| DUMP | SAP stock dump | Material, unrestricted stock and related SAP stock fields | `wms.sap_stk_dump` |
| Stock_Entry | Physical stock | MFG month, BIN, SKU, product name, quantity and status/computation fields | `wms.phy_stk_entry` |
| SO_DISPATCH | Sales-order / dispatch | SO, SKU, requested qty, status, selected bin, dispatch qty, MFG | `wms.clear_order` / compatibility layer as applicable |
| MOVEMENT_REPORT | Stock movement audit | Timestamp, SO, SKU, BIN, quantity, MFG, user | `wms.bin_txin` / movement compatibility layer |
| Bin_Master | Bin master | Bin/warehouse/zone/type/capacity/status information | `wms.bin_masters` |
| Product_Master | SKU master | SKU and product description | `wms.sku_masters` |

## Confirmed source behavior

### Sales order read
`getSalesOrder(soNumber)` reads `SO_DISPATCH`, returns non-dispatched rows, and exposes row, SKU, quantity and status.

### Physical stock read
`getStockForSku(sku)` reads `Stock_Entry`, filters by normalized SKU, returns MFG month, BIN, quantity and product name, then sorts by MFG order.

### Dispatch side effects
The current dispatch implementation updates the SO status/bin/dispatch quantity/MFG, removes physical stock, and appends a movement record. This operation must be treated as a transaction in SQL.

### SAP vs physical comparison
`runSapVsPhysical()` aggregates unrestricted SAP quantity from `DUMP` and physical quantity from `Stock_Entry` by material/SKU and produces `SAPvsPHY` with SAP Qty, Physical Qty, Difference and status (`SHORTAGE`, `EXCESS`, `OK`).

## Known production-wide dependencies

The migration manifest identifies additional production sheets/modules including SAP allocation, partial/clear orders, shortage, order checker, warehouse/bin/SKU/party/mail masters, BIN_TXIN, physical allocation, Operation_Sheet, Outward_MIS, CCI, ACTIVITY_LOG, ASN and INWARD_MIS.

These are not to be reconstructed from assumptions. Exact current headers and row data must be captured from the live source/export before final data import mapping.

## Intake requirements before import

1. Export current production Google Sheets data to XLSX/CSV or provide connector-readable sheet contents.
2. Capture exact header names and column order for every production sheet.
3. Capture row counts, including empty/template rows where they affect application logic.
4. Record date/time, number and text normalization rules without changing source values.
5. Identify duplicate keys and intentional duplicates.
6. Preserve status strings exactly.
7. Preserve MFG month/batch representations exactly before transformation.
8. Validate warehouse/plant relationships.
9. Validate SO/OBD/invoice relationships.
10. Produce a dry-run import report before any SQL write.

## Safety gates

- `LIVE_IMPORT`: OFF
- `PRODUCTION_CUTOVER`: BLOCKED
- `GAS_GOLD_MASTER`: ON
- `DESTRUCTIVE_MIGRATION`: OFF
- `PARITY_REQUIRED`: YES

## Parity requirements

Critical workflows must compare returned JSON/status, changed rows, quantities, allocations, statuses, movement/audit records and downstream report rows between GAS and SQL before frontend cutover.

## Next phase

Phase 9B should consume an actual current source export and generate:

- exact source inventory;
- per-sheet header manifest;
- row-count report;
- duplicate/key analysis;
- null/type analysis;
- source-to-SQL mapping;
- transformation rules;
- dry-run import SQL/CSV package;
- validation queries;
- rollback plan.

No guessed production values are permitted in the Phase 9B import package.
