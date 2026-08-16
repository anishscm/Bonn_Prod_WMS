-- Phase 9B: Source staging / dry-run contract
-- SAFETY: staging only; does not write to production WMS tables.
-- Intended for a disposable PostgreSQL database or a dedicated staging schema.

CREATE SCHEMA IF NOT EXISTS wms_stage;

CREATE TABLE IF NOT EXISTS wms_stage.source_rows (
  id bigserial PRIMARY KEY,
  source_sheet text NOT NULL,
  source_row_number integer NOT NULL,
  source_key text,
  raw_json jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_sheet, source_row_number)
);

CREATE TABLE IF NOT EXISTS wms_stage.reconciliation (
  id bigserial PRIMARY KEY,
  source_sheet text NOT NULL,
  source_row_number integer,
  source_key text,
  target_table text,
  target_key text,
  status text NOT NULL CHECK (status IN ('READY','REJECTED','DUPLICATE','MISSING_KEY','QUANTITY_MISMATCH','NOT_MAPPED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_stage_source_sheet_key
  ON wms_stage.source_rows (source_sheet, source_key);

CREATE INDEX IF NOT EXISTS ix_stage_reconciliation_status
  ON wms_stage.reconciliation (status, source_sheet);

-- Source sheets currently identified from the Gold Master:
-- DUMP, Stock_Entry, SO_DISPATCH, MOVEMENT_REPORT, Bin_Master, Product_Master.
-- Do not insert live data until an exported source dataset has been reviewed.

-- Required dry-run reconciliation sequence:
-- 1. Load exported rows into wms_stage.source_rows only.
-- 2. Validate required business keys and numeric quantities.
-- 3. Detect duplicate source keys before target mapping.
-- 4. Generate wms_stage.reconciliation rows.
-- 5. Compare source row/quantity totals with the proposed target mapping.
-- 6. Obtain explicit review of REJECTED/DUPLICATE/NOT_MAPPED rows.
-- 7. Only after parity approval may a separate migration transaction target wms.* tables.
