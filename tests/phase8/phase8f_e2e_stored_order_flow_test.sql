\set ON_ERROR_STOP on

BEGIN;

INSERT INTO wms.phase8f_e2e_flow_compat
    (warehouse, so_number, obd, pgi, allocation_status, allocation_remark,
     batch_allocations, short_lines, final_dump_rows)
VALUES
    ('BB04','SO1001','800001','900001','PARTIAL','PARTIAL ALLOCATION - BATCH',
     'SKU-A[B001(50),B002(30)];SKU-B[B003(20)]',
     '[SKU-B short 10]',
     '[BB04,FG01,SKU-A,20]');

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM wms.phase8f_e2e_flow_compat
  WHERE warehouse='BB04' AND so_number='SO1001';
  IF r.allocation_status <> 'PARTIAL' THEN
    RAISE EXCEPTION 'Phase 8F status contract failed';
  END IF;
  IF r.pgi <> '900001' THEN
    RAISE EXCEPTION 'Phase 8F PGI contract failed';
  END IF;
  IF r.batch_allocations NOT LIKE '%SKU-A%' THEN
    RAISE EXCEPTION 'Phase 8F batch allocation contract failed';
  END IF;
END $$;

ROLLBACK;

SELECT 'Phase 8F SQL end-to-end stored-order flow contract: PASS' AS result;
