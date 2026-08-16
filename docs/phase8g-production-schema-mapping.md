# Phase 8G — Production Schema Mapping Gate

## Purpose

Phase 8F is green, but its compatibility table is intentionally test-only. Phase 8G defines the production mapping gate without enabling production writes.

## Known production WMS tables

| Business role | Production table | Confirmed columns from supplied schema |
|---|---|---|
| Stored order / operation | `wms.operation_sheet` | `sales_document`, `order_date`, `customer_name`, `customer_ref_no`, `order_qty`, `shortage_qty`, `allocation_remark`, `shortage_remark`, `obd`, `order_status`, `vehicle_number`, `driver_number`, `tpt_name`, `dispatch_qty`, `shortage_reason`, `loading_supervisor`, `billing_supervisor`, `shift`, `loading_date`, `contractor_name`, `loading_start_time`, `loading_end_time` |
| Outward MIS | `wms.outward_mis` | `sales_document`, `order_date`, `customer_name`, `customer_ref_no`, `order_qty`, `shortage_qty`, `allocation_remark`, `shortage_remark`, `obd`, `order_status`, `vehicle_number`, `driver_number`, `tpt_name`, `sku`, `description`, `batch`, `pgi_qty`, `dispatch_qty`, `shortage_reason`, `loading_supervisor`, `billing_supervisor`, `shift`, `loading_date`, `contractor_name`, `loading_start_time`, `loading_end_time` |
| Physical stock allocation | `wms.phy_stk_allocation` | `warehouse`, `event_timestamp`, `so_number`, `sku`, `allocated_qty`, `bin`, `mfg_month`, `updated_by` |
| Physical stock entry | `wms.phy_stk_entry` | `mfg_month`, `bin`, `sku`, `product_name`, `qty`, `computation_logic`, `plant`, `status` |
| SAP allocation | `wms.sap_stk_allocation` | `warehouse`, `event_timestamp`, `so_number`, `so_date`, `party_name_dest_city_name`, `reference`, `sku`, `inhand_alloc`, `transit_alloc`, `updated_by` |
| Bin transaction audit | `wms.bin_txin` | `warehouse`, `event_timestamp`, `bin`, `sku`, `qty`, `batch`, `transaction_type`, `doc_number`, `user_id` |
| SAP stock dump | `wms.sap_stk_dump` | table exists; complete column mapping was not supplied in the current schema extract |
| Dispatch register | `wms.clear_order` | table exists; complete column mapping was not supplied in the current schema extract |

## Phase 8F compatibility boundary

The Phase 8F compatibility table is **not** a production replacement. It stores a serialized contract for test parity only and explicitly states that no production writer is enabled.

## Required before production writer

1. Fetch the complete column schema for `wms.sap_stk_dump`.
2. Fetch the complete column schema for `wms.clear_order`.
3. Confirm the real primary/unique keys and update predicates for `operation_sheet`, `outward_mis`, `phy_stk_allocation`, `sap_stk_allocation`, and `bin_txin`.
4. Confirm RLS policies/permissions for every production table touched by the flow.
5. Implement an adapter that maps Phase 8F calculation output to those exact production columns.
6. Run the adapter against a disposable PostgreSQL database containing the production-shaped schema.
7. Require response-state and post-operation-state parity before enabling production writes.

## Safety rule

No production insert/update/delete is enabled by Phase 8G. The Google Apps Script WMS remains the Gold Master / rollback system until the production adapter passes the parity gate.
