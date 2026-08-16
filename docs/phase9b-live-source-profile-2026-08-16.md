# Phase 9B — Live Source Workbook Profile

Source workbook: `Bonn_Prod_WMS.xlsx`
Profile date: 2026-08-16

## Source row counts

| Sheet | Data rows |
|---|---:|
| ASN | 48 |
| Outward_MIS | 1,367 |
| INWARD_MIS | 111 |
| Operation_Sheet | 281 |
| USER_AUTH | 11 |
| ACTIVITY_LOG | 7 |
| CCI | 201 |
| SAP_STK_DUMP | 158 |
| PHY_STK_ENTRY | 360 |
| PHY_STK_ALLOCATION | 1,085 |
| BIN_TXIN | 618 |
| Mail Id masters | 11 |
| Partial Clear Orders | 8 |
| Shortage in Partial Clear Order | 10 |
| SAP_STK_ALLOCATION | 142 |
| Clear Order | 2 |
| BIN_MASTERS | 305 |
| ORDER_CHECKER | 14 |
| WH_MASTERS | 7 |
| SKU_MASTERS | 158 |
| PARTY_MASTER | 25 |

Total non-empty data rows across listed sheets: 4,930.

## Direct production mappings verified by header compatibility

- `Outward_MIS` -> `wms.outward_mis` (27 business columns; target also has id/created_at/updated_at).
- `INWARD_MIS` -> `wms.inward_mis` (27 business columns; target also has id/created_at/updated_at).
- `Operation_Sheet` -> `wms.operation_sheet` (24 business columns; target also has distribution channel plus id/timestamps; source currently lacks a distribution-channel value in the header set).
- `USER_AUTH` -> `wms.user_auth` (source has 28 permission/business columns; target has 30 including id/timestamps/other fields; exact target columns must be rechecked before import).
- `ACTIVITY_LOG` -> `wms.activity_log` (5 source columns; target has 6 including id/timestamp structure).
- `CCI` -> `wms.cci` (18 source columns; target has 21; audit-related fields require exact mapping).
- `SAP_STK_DUMP` -> `wms.sap_stk_dump` (7 business columns exactly matching target business columns).
- `PHY_STK_ENTRY` -> `wms.phy_stk_entry` (8 business columns matching target business columns).
- `PHY_STK_ALLOCATION` -> `wms.phy_stk_allocation` (source has 8 business columns, including MFG Month and Bin; target has 8 business columns).
- `BIN_TXIN` -> `wms.bin_txin` (9 source business columns; target has 10 business columns plus id; `created_at` is target-generated).
- `Partial Clear Orders` -> `wms.partial_clear_orders` (10 source business columns; target has 12 including id/timestamps).
- `Shortage in Partial Clear Order` -> `wms.shortage_partial_orders` (15 source business columns; target has 17 including id/timestamps).
- `SAP_STK_ALLOCATION` -> `wms.sap_stk_allocation` (10 source business columns; target has 11 business columns because target includes `event_timestamp` plus id/created_at; source timestamp corresponds to event timestamp).
- `Clear Order` -> `wms.clear_order` (10 source business columns; target has 10 business columns plus id/created_at).
- `BIN_MASTERS` -> `wms.bin_masters` requires exact target schema verification before import because source has 6 columns while target has 9.
- `WH_MASTERS` -> `wms.wh_masters` requires exact target schema verification because source has 4 columns while target has 7.
- `SKU_MASTERS` -> `wms.sku_masters` requires exact target schema verification because source has 5 columns while target has 5; names/order need normalized mapping.
- `PARTY_MASTER` -> `wms.party_master` requires exact target schema verification because source has 4 columns while target has 7.
- `ORDER_CHECKER` is an operational/reporting sheet and should not be blindly imported into `wms.order_checker` until target columns and derived-vs-persisted semantics are confirmed.
- `ASN` has 13 source columns while `wms.asn` has 16; exact target mapping must be verified before import.
- `Mail Id masters` should map to `wms.mail_id_masters` only after target schema/field semantics are verified.

## Important source-data observations

1. `SAP_STK_DUMP` contains JSON batch arrays in `Batch(Qty)`, e.g. `[{'batch':..., 'qty':...}]`; migration must preserve valid JSON semantics and numeric quantities.
2. `PHY_STK_ALLOCATION` includes `Bin` and `MFG Month` fields in the workbook even though earlier compact source excerpts omitted them; these fields must be retained because the production target has both.
3. `BIN_TXIN` contains batch values that may be parsed as spreadsheet dates in the XLSX representation. Import must preserve the original source meaning and must not silently convert a batch identifier into a PostgreSQL date.
4. `Clear Order` and `Partial Clear Orders` store item lines as JSON strings; these must remain structurally valid JSON and must not be flattened/reconstructed without parity checks.
5. `USER_AUTH` contains credential-like fields including passwords. These must not be copied into logs, GitHub commits, test fixtures, or client-side code. Production import must use a secure credential migration strategy.
6. The workbook is a real data snapshot, so migration should use a staging layer and reconciliation before writing into `wms.*`.

## Current migration gate

- Workbook profiling: PASS
- Source row counts: PASS
- Basic header inventory: PASS
- Direct business-column mapping: PARTIAL/PASS as noted above
- Exact target schema reconciliation for all 21 source sheets: PENDING
- Production import: OFF
- Supabase production data remains untouched

## Required next step

Fetch the complete target column schema for the remaining ambiguous master/report tables (`asn`, `user_auth`, `activity_log`, `cci`, `bin_masters`, `wh_masters`, `party_master`, `order_checker`, `mail_id_masters`) and then generate a deterministic staging import manifest. No production `INSERT`, `UPDATE`, or `DELETE` should occur until the staging reconciliation is clean.