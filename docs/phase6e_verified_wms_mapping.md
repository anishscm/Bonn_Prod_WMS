# Phase 6E — Verified Supabase outbound column contract

Source: user-supplied `information_schema.columns` output from BONN-Prod-WMS Supabase project.

## `wms.phy_stk_entry`

- id
- mfg_month
- bin
- sku
- product_name
- qty
- computation_logic
- plant
- status
- created_at
- updated_at

## `wms.phy_stk_allocation`

- id
- warehouse
- event_timestamp
- so_number
- sku
- allocated_qty
- bin
- mfg_month
- updated_by
- created_at

## `wms.bin_txin`

- id
- warehouse
- event_timestamp
- bin
- sku
- qty
- batch
- transaction_type
- doc_number
- user_id
- created_at

## `wms.sap_stk_allocation`

- id
- warehouse
- event_timestamp
- so_number
- so_date
- party_name_dest_city_name
- reference
- sku
- inhand_alloc
- transit_alloc
- updated_by
- created_at

## `wms.operation_sheet`

- id
- plant
- distribution_channel
- sales_document
- order_date
- customer_name
- customer_ref_no
- order_qty
- shortage_qty
- allocation_remark
- shortage_remark
- obd
- order_status
- vehicle_number
- driver_number
- tpt_name
- dispatch_qty
- shortage_reason
- loading_supervisor
- billing_supervisor
- shift
- loading_date
- contractor_name
- loading_start_time
- loading_end_time
- created_at
- updated_at

## `wms.outward_mis`

- id
- plant
- sales_document
- order_date
- customer_name
- customer_ref_no
- order_qty
- shortage_qty
- allocation_remark
- shortage_remark
- obd
- order_status
- vehicle_number
- driver_number
- tpt_name
- sku
- description
- batch
- pgi_qty
- dispatch_qty
- shortage_reason
- loading_supervisor
- billing_supervisor
- shift
- loading_date
- contractor_name
- loading_start_time
- loading_end_time
- created_at
- updated_at

## Mapping rule

The column names above are verified schema facts. They do **not** by themselves define business semantics. SAP dump deduction and GAS status/value semantics remain adapter responsibilities until a Gold Master before/after snapshot proves parity.

The outbound service therefore fails closed when any required side-effect adapter is missing instead of committing a partial inventory transaction.
