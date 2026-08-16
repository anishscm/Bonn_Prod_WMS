-- Phase 7B — verified wms.inward_mis mapping
-- READ/DDL migration file only. Do NOT run against production until Phase 7B gate passes.
-- Gold Master iwBatchInwardWithMIS produces 12 logical fields:
-- timestamp, OBD, OBD date, vehicle, date, SKU, MFG, SAP qty,
-- received qty, short/excess, status, inwarded-by.
--
-- Verified target has 30 columns. Only source-supported fields are populated;
-- fields not produced by iwBatchInwardWithMIS remain NULL/default rather than being invented.

CREATE TABLE IF NOT EXISTS wms.stock_entry_compat (
  id BIGSERIAL PRIMARY KEY,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  mfg_month TEXT,
  bin TEXT,
  sku TEXT,
  product_name TEXT,
  qty NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_entry_compat_match_idx
  ON wms.stock_entry_compat (mfg_month, bin, sku, id);

CREATE OR REPLACE FUNCTION wms.insert_inward_mis_gas_compat(
  p_print_datetime TIMESTAMPTZ,
  p_obd_no_mat_doc TEXT,
  p_invoice_date DATE,
  p_vehicle_no TEXT,
  p_unloading_date DATE,
  p_material_code TEXT,
  p_phy_batch TEXT,
  p_bill_qty NUMERIC,
  p_phy_qty NUMERIC,
  p_short_excess NUMERIC,
  p_status TEXT,
  p_deo TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO wms.inward_mis (
    print_datetime,
    obd_no_mat_doc,
    invoice_date,
    vehicle_no,
    unloading_date,
    material_code,
    phy_batch,
    bill_qty,
    phy_qty,
    short_excess,
    status,
    deo
  )
  VALUES (
    p_print_datetime,
    p_obd_no_mat_doc,
    p_invoice_date,
    p_vehicle_no,
    p_unloading_date,
    p_material_code,
    p_phy_batch,
    p_bill_qty,
    p_phy_qty,
    p_short_excess,
    p_status,
    p_deo
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
