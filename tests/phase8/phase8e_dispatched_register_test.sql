-- Phase 8E disposable PostgreSQL compatibility-schema test.
-- The CI database is disposable; no production data is touched.

BEGIN;

INSERT INTO wms.dispatched_register_compat (
    warehouse, so_number, party_name, dest_city, so_date, so_time,
    submit_time, obd, pgi, vehicle_number, driver_contact, total_boxes,
    contractor_name, supervisor_name, operator_name, dispatch_status, dispatched_at
) VALUES (
    'BB04', '789012', 'BONN GROCERY HUB', 'JALANDHAR', '2026-06-15', '11:00',
    '15-Jun-2026 11:15', '87654321', '1234567890', 'PB10AB1234', '9876543210', 200,
    'Contractor A', 'Supervisor A', 'Operator A', 'DISPATCHED', '16-Aug-2026 12:00'
);

DO $$
DECLARE r RECORD;
BEGIN
    SELECT * INTO r
    FROM wms.dispatched_register_compat
    WHERE warehouse='BB04' AND so_number='789012';

    IF r.dispatch_status <> 'DISPATCHED' THEN RAISE EXCEPTION 'status mismatch'; END IF;
    IF r.obd <> '87654321' THEN RAISE EXCEPTION 'OBD mismatch'; END IF;
    IF r.pgi <> '1234567890' THEN RAISE EXCEPTION 'PGI mismatch'; END IF;
    IF r.total_boxes <> 200 THEN RAISE EXCEPTION 'dispatch qty mismatch'; END IF;
    IF r.vehicle_number <> 'PB10AB1234' THEN RAISE EXCEPTION 'vehicle mismatch'; END IF;
END $$;

ROLLBACK;

\echo 'Phase 8E dispatched-register SQL contract test: PASS'
