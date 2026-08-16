-- PHASE 8E — DISPATCHED / OUTWARD REGISTER COMPATIBILITY CONTRACT
-- TEST / PARITY ONLY. Do not enable production writes until the Gold-Master
-- source-to-SQL controlled capture passes.
--
-- The production Dispatch UI exposes a 17-field register contract:
-- warehouse, SO, party, destination, SO date/time, submit time, OBD, PGI,
-- vehicle, driver contact, dispatch quantity/boxes, contractor, supervisor,
-- operator, dispatch status and dispatch timestamp.

CREATE TABLE IF NOT EXISTS wms.dispatched_register_compat (
    id BIGSERIAL PRIMARY KEY,
    warehouse TEXT NOT NULL DEFAULT '',
    so_number TEXT NOT NULL DEFAULT '',
    party_name TEXT NOT NULL DEFAULT '',
    dest_city TEXT NOT NULL DEFAULT '',
    so_date DATE,
    so_time TEXT NOT NULL DEFAULT '',
    submit_time TEXT NOT NULL DEFAULT '',
    obd TEXT NOT NULL DEFAULT '',
    pgi TEXT NOT NULL DEFAULT '',
    vehicle_number TEXT NOT NULL DEFAULT '',
    driver_contact TEXT NOT NULL DEFAULT '',
    total_boxes NUMERIC(18,3) NOT NULL DEFAULT 0,
    contractor_name TEXT NOT NULL DEFAULT '',
    supervisor_name TEXT NOT NULL DEFAULT '',
    operator_name TEXT NOT NULL DEFAULT '',
    dispatch_status TEXT NOT NULL DEFAULT 'PENDING',
    dispatched_at TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dispatched_register_compat_wh_so UNIQUE (warehouse, so_number),
    CONSTRAINT ck_dispatched_register_compat_status CHECK (dispatch_status IN ('PENDING','DISPATCHED'))
);

CREATE INDEX IF NOT EXISTS ix_dispatched_register_compat_wh_status
    ON wms.dispatched_register_compat(warehouse, dispatch_status);

CREATE INDEX IF NOT EXISTS ix_dispatched_register_compat_obd
    ON wms.dispatched_register_compat(warehouse, obd);

CREATE INDEX IF NOT EXISTS ix_dispatched_register_compat_pgi
    ON wms.dispatched_register_compat(warehouse, pgi);
