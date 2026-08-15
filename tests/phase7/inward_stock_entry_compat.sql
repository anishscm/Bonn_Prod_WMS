-- Phase 7A disposable compatibility representation for Gold-Master Stock_Entry.
-- This is intentionally NOT a production migration.
-- GAS Stock_Entry is a six-column sheet: timestamp, mfg_month, bin, sku, product_name, qty.

CREATE SCHEMA IF NOT EXISTS wms;

CREATE TABLE IF NOT EXISTS wms.stock_entry_compat (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mfg_month TEXT,
  bin TEXT,
  sku TEXT,
  product_name TEXT,
  qty NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_stock_entry_compat_sku_mfg_bin
  ON wms.stock_entry_compat (sku, mfg_month, bin);

CREATE INDEX IF NOT EXISTS ix_stock_entry_compat_sku
  ON wms.stock_entry_compat (sku);
