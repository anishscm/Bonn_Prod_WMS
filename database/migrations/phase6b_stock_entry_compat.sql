-- PHASE 6B — PROPOSED / TEST ONLY
-- Do not apply to production until the parity contract passes.
-- Legacy GAS Stock_Entry is kept as a separate compatibility contract.

CREATE TABLE IF NOT EXISTS wms.stock_entry_compat (
    id BIGSERIAL PRIMARY KEY,
    timestamp_text TEXT DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    qty NUMERIC(18,3) NOT NULL DEFAULT 0,
    mfg_month TEXT DEFAULT '',
    bin TEXT DEFAULT '',
    plant TEXT DEFAULT '',
    transaction_type TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    username TEXT DEFAULT '',
    source_operation TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_stock_entry_compat_sku_plant
    ON wms.stock_entry_compat(plant, sku);

CREATE INDEX IF NOT EXISTS ix_stock_entry_compat_bin
    ON wms.stock_entry_compat(plant, bin);
