-- Phase 7A disposable compatibility schema.
-- Mirrors the six business columns used by Gold-Master Stock_Entry:
-- timestamp, MFG, BIN, SKU, product name, quantity.
-- This is NOT production cutover SQL.

CREATE SCHEMA IF NOT EXISTS wms;

CREATE TABLE IF NOT EXISTS wms.stock_entry_compat (
  id BIGSERIAL PRIMARY KEY,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  mfg_month TEXT,
  bin TEXT,
  sku TEXT,
  product_name TEXT,
  qty NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_entry_compat_key
  ON wms.stock_entry_compat (mfg_month, bin, sku);

-- Deterministic fixture: two rows with the same key simulate the
-- first-match behavior of saveOrUpdateStock when the sheet contains
-- duplicate legacy rows.
INSERT INTO wms.stock_entry_compat (mfg_month, bin, sku, product_name, qty)
VALUES ('08/26','FG01','TEST-SKU-P7','TEST ITEM',100)
ON CONFLICT DO NOTHING;

SELECT mfg_month, bin, sku, qty
FROM wms.stock_entry_compat
WHERE sku='TEST-SKU-P7'
ORDER BY id;
