# Phase 9A — Google Sheets Source Data Discovery

## Objective

Supabase WMS tables are structurally ready but currently contain zero business rows. The live source remains the Google Sheets + Apps Script WMS. The migration must therefore discover and map the actual source sheets before any data import.

## Source evidence

The Gold-Master manifest states that the Google Sheets data model is behavioral: sheet names, column positions, row updates, JSON columns, status text and cross-sheet writes participate in application logic. The migration must preserve those contracts rather than blindly normalize them.

The verified source code also confirms these legacy sheets:

- `DUMP`
- `Stock_Entry`
- `SO_DISPATCH`
- `Bin_Master`
- `Product_Master`
- `MOVEMENT_REPORT`
- `SAPvsPHY`

The larger Gold-Master manifest identifies additional operational sheets:

- `SAP_STK_ALLOCATION`
- `Partial Clear Orders`
- `Shortage in Partial Clear Orders`
- `Clear Order`
- `ORDER_CHECKER`
- `WH_MASTERS`
- `BIN_MASTERS`
- `SKU_MASTERS`
- `PARTY_MASTER`
- `Mail Id masters`
- `BIN_TXIN`
- `PHY_STK_ENTRY`
- `PHY_STK_ALLOCATION`
- `Operation_Sheet`
- `Outward_MIS`
- `CCI`
- `ACTIVITY_LOG`
- `ASN`
- `INWARD_MIS`

## Confirmed source behavior

`getSalesOrder()` reads `SO_DISPATCH` and returns row number, SKU, quantity and status. It excludes rows whose status is `Dispatch` in the newer verified source variant.

`getStockForSku()` reads `Stock_Entry`, using columns for MFG month, bin, SKU, quantity and product name, and sorts the result by MFG month.

`confirmDispatch()` updates `SO_DISPATCH`, removes the selected quantity from physical stock and appends a movement row to `MOVEMENT_REPORT`.

The source manifest also identifies multi-table critical flows such as outbound confirmation, inward confirmation and batch deduction. These must be migrated as atomic transactions, not as independent row imports.

## Provisional source → PostgreSQL mapping

| Google Sheets source | PostgreSQL target | Confidence |
|---|---|---|
| `DUMP` | `wms.sap_stk_dump` | High — verified source behavior + existing schema |
| `Stock_Entry` | `wms.phy_stk_entry` | High |
| `SO_DISPATCH` | `wms.order_checker` / outbound flow tables | Medium — exact production source contract must be verified |
| `MOVEMENT_REPORT` | `wms.bin_txin` / audit flow | Medium — exact columns must be verified |
| `SAP_STK_ALLOCATION` | `wms.sap_stk_allocation` | High |
| `PHY_STK_ENTRY` | `wms.phy_stk_entry` | High |
| `PHY_STK_ALLOCATION` | `wms.phy_stk_allocation` | High |
| `Operation_Sheet` | `wms.operation_sheet` | High |
| `Outward_MIS` | `wms.outward_mis` | High |
| `Clear Order` | `wms.clear_order` | High |
| `Partial Clear Orders` | `wms.partial_clear_orders` | High |
| `Shortage in Partial Clear Orders` | `wms.shortage_partial_orders` | High |
| `ORDER_CHECKER` | `wms.order_checker` | High |
| `INWARD_MIS` | `wms.inward_mis` | High |
| `ASN` | `wms.asn` | High |
| `CCI` | `wms.cci` | High |
| `ACTIVITY_LOG` | `wms.activity_log` | High |
| `WH_MASTERS` | `wms.wh_masters` | High |
| `BIN_MASTERS` / `Bin_Master` | `wms.bin_masters` | Medium — duplicate legacy naming must be reconciled |
| `SKU_MASTERS` / `Product_Master` | `wms.sku_masters` | Medium — duplicate legacy naming must be reconciled |
| `PARTY_MASTER` | `wms.party_master` | High |
| `Mail Id masters` | `wms.mail_id_masters` | High |

## Required data-import rules

1. Do not import from guessed sheet names when both legacy and newer names exist.
2. Freeze the current GAS WMS as Gold Master during migration.
3. Export source headers and row counts first.
4. Preserve text identifiers exactly where application logic depends on them.
5. Normalize warehouse/SKU/SO only in the adapter layer where Gold-Master logic does so.
6. Do not import derived/report-only sheets until their source dependency is known.
7. Do not import live allocation rows before the corresponding stock/order source is imported and validated.
8. Record source row numbers/identifiers where useful for audit and reconciliation.
9. Run a dry-run transformation before any Supabase insert.
10. Compare counts, quantities, allocations, statuses and key identifiers before committing the import.

## Current blocker

The Google Sheet itself has not yet been fetched through a connector in this migration environment. Therefore this phase does **not** claim actual live row counts or actual current sheet headers beyond the source files already provided.

The next safe operation is to obtain a source export (XLSX/CSV) or connector-readable Google Sheet contents, then generate the exact import manifest from the live data.

No production Supabase data is modified by Phase 9A.
