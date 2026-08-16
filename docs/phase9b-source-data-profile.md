# Phase 9B — Source Data Profiling & Dry-Run Intake Contract

## Status

Design/profiling contract only. No live Google Sheet read and no Supabase write are performed by this document.

## Verified source sheets

The Gold-Master parity specification identifies these sheet references in the verified backend:

- `Bin_Master`
- `DUMP`
- `MOVEMENT_REPORT`
- `Product_Master`
- `SAPvsPHY`
- `SO_DISPATCH`
- `Stock_Entry`

The source specification explicitly says the verified `Code.gs(22)` is only a subset of the production backend and must not be treated as the complete backend. The migration must inventory the complete production RPC surface before cutover.

## Verified source contracts

### Bin_Master

The verified backend reads columns A:B from row 2 onward and maps them to:

- column A → normalized bin
- column B → numeric capacity

### Product_Master

The verified backend reads columns A:B from row 2 onward and maps them to:

- column A → normalized SKU
- column B → product name

### Stock_Entry

The verified backend uses columns A:F and maps:

- column B → MFG month
- column C → BIN
- column D → SKU
- column E → product name
- column F → quantity

Column A is read/written as a timestamp in the verified stock writer, but it is not part of the stock lookup key.

The stock lookup key is `(MFG month, BIN, SKU)`. Stock save adds quantity to an existing matching row; stock removal returns `ERROR` when requested quantity exceeds available, deletes the row when quantity becomes zero, and otherwise reduces the quantity.

### DUMP

The verified SAP-vs-physical logic reads the sheet header dynamically and requires a header containing `MATERIAL` and a header containing `UNRESTRICT`. Exact remaining DUMP columns must be obtained from the current live source before import.

### SO_DISPATCH

The verified backend reads SO number from column A and SKU/quantity/status from columns F:G:H. Dispatch confirmation writes:

- H → `Dispatch`
- I → BIN
- J → picked quantity
- K → MFG

The exact complete live header must be captured before migration because the broader production backend contains additional order workflows.

### MOVEMENT_REPORT

The verified dispatch function appends:

`timestamp, SO, SKU, BIN, quantity, MFG, active-user-email`

This is an audit/event source and must not be treated as interchangeable with current stock.

## Profiling rules

For every source sheet, the eventual dry-run profiler must produce:

1. sheet name
2. header row
3. column count
4. row count
5. non-empty count per column
6. blank count per column
7. distinct count for business keys
8. duplicate-key count
9. numeric parse failures for quantity columns
10. negative quantity count
11. date/time parse failures
12. representative sample rows with sensitive values redacted where required

## Business-key checks

### Stock_Entry

Expected candidate key:

`normalized(MFG month) + normalized(BIN) + normalized(SKU)`

Duplicate rows require review because the Gold-Master save logic consolidates matching rows by this key.

### SO_DISPATCH

Candidate identity is not assumed to be only SO number because one SO can contain multiple SKU lines. The exact composite line key must be derived from the live production header and complete backend behavior.

### DUMP

Candidate identity is not assumed to be `(warehouse, material)` in the Google Sheet. The PostgreSQL target uses warehouse/material, but the source contract must be reconciled against the live DUMP structure before import.

## Dry-run import rule

No INSERT/UPDATE/DELETE should be generated against production Supabase during profiling.

The dry-run output must contain:

- source row count
- accepted row count
- rejected row count
- duplicate count
- transformed row count
- target table/row estimate
- validation errors
- deterministic checksum of normalized business rows

## Import order

After profiling passes, the safe initial order is:

1. `wh_masters`
2. `sku_masters`
3. `bin_masters`
4. source SAP dump → `sap_stk_dump`
5. physical stock → `phy_stk_entry`
6. physical allocation → `phy_stk_allocation`
7. SAP allocation → `sap_stk_allocation`
8. orders → `operation_sheet` / related outbound tables
9. dispatch register → `clear_order`
10. movement/audit records

This order is provisional and must be reconciled against the complete production RPC/schema contract before executing a migration.

## Safety gate

The current GAS WMS remains Gold Master. The Supabase database is currently empty across the WMS tables based on the supplied row-count verification, so there is no valid Supabase source dataset to migrate internally.

Phase 9B is complete only when the actual current Google Sheet export/connector data has been profiled. Until then, no live data import is authorized.
