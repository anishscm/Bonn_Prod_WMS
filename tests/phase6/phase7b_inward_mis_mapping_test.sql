-- Phase 7B disposable test for the verified production INWARD_MIS shape.
-- No production connection. Creates a disposable WMS-shaped table and verifies
-- the source-supported GAS logical fields land in the intended columns while
-- unsupported fields remain NULL/default.

CREATE SCHEMA IF NOT EXISTS wms;

CREATE TABLE IF NOT EXISTS wms.inward_mis (
  id BIGSERIAL PRIMARY KEY,
  plant_code TEXT,
  print_datetime TIMESTAMPTZ,
  obd_no_mat_doc TEXT,
  invoice_num TEXT,
  invoice_date DATE,
  vehicle_no TEXT,
  material_code TEXT,
  material_description TEXT,
  billed_batch TEXT,
  bill_qty NUMERIC,
  phy_batch TEXT,
  phy_qty NUMERIC,
  short_excess NUMERIC,
  bin TEXT,
  status TEXT,
  supervisor_name TEXT,
  deo TEXT,
  contractor_name TEXT,
  start_time TIME,
  end_time TIME,
  dock_num TEXT,
  shift TEXT,
  confirmation_datetime TIMESTAMPTZ,
  grn_num TEXT,
  line_status TEXT,
  unloading_date DATE,
  loading_supervisor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

TRUNCATE wms.inward_mis;

SELECT wms.insert_inward_mis_gas_compat(
  '2026-08-16 10:00:00+05:30',
  'OBD-P7B-001',
  '2026-08-15',
  'HR-TEST-001',
  '2026-08-16',
  'TEST-SKU-P7B',
  'AUG26',
  100,
  98,
  -2,
  'SHORT',
  NULL
);

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM wms.inward_mis WHERE obd_no_mat_doc='OBD-P7B-001' ORDER BY id DESC LIMIT 1;
  IF r.material_code <> 'TEST-SKU-P7B' THEN RAISE EXCEPTION 'material_code mapping failed'; END IF;
  IF r.phy_batch <> 'AUG26' THEN RAISE EXCEPTION 'phy_batch mapping failed'; END IF;
  IF r.bill_qty <> 100 THEN RAISE EXCEPTION 'bill_qty mapping failed'; END IF;
  IF r.phy_qty <> 98 THEN RAISE EXCEPTION 'phy_qty mapping failed'; END IF;
  IF r.short_excess <> -2 THEN RAISE EXCEPTION 'short_excess mapping failed'; END IF;
  IF r.status <> 'SHORT' THEN RAISE EXCEPTION 'status mapping failed'; END IF;
  IF r.vehicle_no <> 'HR-TEST-001' THEN RAISE EXCEPTION 'vehicle mapping failed'; END IF;
  IF r.confirmation_datetime IS NOT NULL THEN RAISE EXCEPTION 'confirmation_datetime must remain NULL for iwBatchInwardWithMIS'; END IF;
  IF r.grn_num IS NOT NULL THEN RAISE EXCEPTION 'grn_num must remain NULL for iwBatchInwardWithMIS'; END IF;
END $$;

SELECT
  obd_no_mat_doc,
  invoice_date,
  vehicle_no,
  material_code,
  phy_batch,
  bill_qty,
  phy_qty,
  short_excess,
  status,
  unloading_date,
  created_at,
  updated_at
FROM wms.inward_mis
WHERE obd_no_mat_doc='OBD-P7B-001';
