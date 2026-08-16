-- PHASE 8F — END-TO-END STORED ORDER FLOW COMPATIBILITY CONTRACT
-- TEST / PARITY ONLY. No production writer is enabled.

CREATE SCHEMA IF NOT EXISTS wms;

CREATE TABLE IF NOT EXISTS wms.phase8f_e2e_flow_compat (
    id BIGSERIAL PRIMARY KEY,
    warehouse TEXT NOT NULL DEFAULT '',
    so_number TEXT NOT NULL DEFAULT '',
    obd TEXT NOT NULL DEFAULT '',
    pgi TEXT NOT NULL DEFAULT '',
    allocation_status TEXT NOT NULL DEFAULT '',
    allocation_remark TEXT NOT NULL DEFAULT '',
    batch_allocations TEXT NOT NULL DEFAULT '',
    short_lines TEXT NOT NULL DEFAULT '',
    final_dump_rows TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_phase8f_e2e_wh_so UNIQUE (warehouse, so_number)
);

CREATE INDEX IF NOT EXISTS ix_phase8f_e2e_wh_status
    ON wms.phase8f_e2e_flow_compat(warehouse, allocation_status);
