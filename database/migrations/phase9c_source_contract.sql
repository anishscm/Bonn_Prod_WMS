-- Phase 9C: source-contract compatibility helpers.
-- No production data writes. Schema mirrors verified Gold-Master contracts.

CREATE SCHEMA IF NOT EXISTS wms_compat;

CREATE TABLE IF NOT EXISTS wms_compat.source_contract (
  logical_object text PRIMARY KEY,
  source_sheet text NOT NULL,
  target_table text NOT NULL,
  contract_version integer NOT NULL DEFAULT 1,
  notes text
);

INSERT INTO wms_compat.source_contract(logical_object,source_sheet,target_table,notes) VALUES
('sap_stock_dump','SAP_STK_DUMP','wms.sap_stk_dump','Warehouse/S.loc/Material/Batch(Qty)/Unrestricted/Transit'),
('sap_allocation','SAP_STK_ALLOCATION','wms.sap_stk_allocation','SO + SKU + inhand/transit allocation'),
('physical_stock','PHY_STK_ENTRY','wms.phy_stk_entry','MFG + BIN + SKU + quantity'),
('physical_allocation','PHY_STK_ALLOCATION','wms.phy_stk_allocation','SO + SKU + BIN + MFG allocation'),
('clear_order','Clear Order','wms.clear_order','Warehouse + SO + lines JSON'),
('operation_sheet','Operation_Sheet','wms.operation_sheet','Outbound operation lifecycle'),
('outward_mis','Outward_MIS','wms.outward_mis','Outbound MIS/report rows'),
('bin_transactions','BIN_TXIN','wms.bin_txin','Inventory movement audit')
ON CONFLICT (logical_object) DO UPDATE SET
  source_sheet=EXCLUDED.source_sheet,
  target_table=EXCLUDED.target_table,
  notes=EXCLUDED.notes;
