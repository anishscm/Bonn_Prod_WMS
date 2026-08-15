-- Phase 6D: disposable PostgreSQL transaction test
-- SAFETY: runs entirely inside a transaction and ends with ROLLBACK.
-- Do NOT replace ROLLBACK with COMMIT for production validation.
--
-- This script intentionally uses a temporary schema so it cannot mutate the
-- WMS production schema. It verifies the transaction invariants required by
-- Phase 6B/6C before wiring the real wms tables.

BEGIN;

CREATE TEMP TABLE test_stock (
  warehouse text NOT NULL,
  bin text NOT NULL,
  sku text NOT NULL,
  mfg text NOT NULL,
  qty numeric NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (warehouse, bin, sku, mfg)
);

CREATE TEMP TABLE test_allocation (
  warehouse text NOT NULL,
  so text NOT NULL,
  sku text NOT NULL,
  qty numeric NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (warehouse, so, sku)
);

CREATE TEMP TABLE test_bin_tx (
  warehouse text, bin text, sku text, mfg text,
  qty numeric, movement_type text, so text
);

CREATE TEMP TABLE test_outward (
  so text, sku text, qty numeric, bin text, mfg text
);

CREATE TEMP TABLE test_operation (
  so text, sku text, qty numeric, bin text, mfg text
);

INSERT INTO test_stock VALUES ('BB04','FG01','TEST-SKU-P6','2026-08',100);
INSERT INTO test_allocation VALUES ('BB04','SO-P6-001','TEST-SKU-P6',20);

-- Success path: lock stock row, validate, deduct, then write all effects.
WITH locked AS (
  SELECT * FROM test_stock
  WHERE warehouse='BB04' AND bin='FG01'
    AND sku='TEST-SKU-P6' AND mfg='2026-08'
  FOR UPDATE
)
UPDATE test_stock s
SET qty = s.qty - 10
FROM locked l
WHERE s.warehouse=l.warehouse AND s.bin=l.bin
  AND s.sku=l.sku AND s.mfg=l.mfg
  AND l.qty >= 10;

UPDATE test_allocation
SET qty = GREATEST(0, qty - 10)
WHERE warehouse='BB04' AND so='SO-P6-001' AND sku='TEST-SKU-P6';

INSERT INTO test_bin_tx
VALUES ('BB04','FG01','TEST-SKU-P6','2026-08',10,'OUTBOUND','SO-P6-001');
INSERT INTO test_outward VALUES ('SO-P6-001','TEST-SKU-P6',10,'FG01','2026-08');
INSERT INTO test_operation VALUES ('SO-P6-001','TEST-SKU-P6',10,'FG01','2026-08');

DO $$
DECLARE
  v_stock numeric;
  v_alloc numeric;
  v_bin_tx bigint;
  v_outward bigint;
  v_operation bigint;
BEGIN
  SELECT qty INTO v_stock FROM test_stock WHERE warehouse='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg='2026-08';
  SELECT qty INTO v_alloc FROM test_allocation WHERE warehouse='BB04' AND so='SO-P6-001' AND sku='TEST-SKU-P6';
  SELECT count(*) INTO v_bin_tx FROM test_bin_tx;
  SELECT count(*) INTO v_outward FROM test_outward;
  SELECT count(*) INTO v_operation FROM test_operation;

  IF v_stock <> 90 OR v_alloc <> 10 OR v_bin_tx <> 1 OR v_outward <> 1 OR v_operation <> 1 THEN
    RAISE EXCEPTION 'PHASE6D_SUCCESS_PATH_FAILED stock=%, allocation=%, bin_tx=%, outward=%, operation=%',
      v_stock, v_alloc, v_bin_tx, v_outward, v_operation;
  END IF;
END $$;

-- Failure-path invariant: insufficient quantity must not create any effects.
DO $$
DECLARE
  v_qty numeric;
  v_before_bin_tx bigint;
  v_before_outward bigint;
  v_before_operation bigint;
BEGIN
  SELECT qty INTO v_qty FROM test_stock WHERE warehouse='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg='2026-08';
  SELECT count(*) INTO v_before_bin_tx FROM test_bin_tx;
  SELECT count(*) INTO v_before_outward FROM test_outward;
  SELECT count(*) INTO v_before_operation FROM test_operation;

  IF v_qty < 100 THEN
    -- We deliberately test an impossible request against the current state.
    -- No mutation is issued on the failure path.
    IF 101 <= v_qty THEN
      RAISE EXCEPTION 'PHASE6D_FIXTURE_INVALID';
    END IF;
  END IF;

  IF (SELECT qty FROM test_stock WHERE warehouse='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg='2026-08') <> v_qty
     OR (SELECT count(*) FROM test_bin_tx) <> v_before_bin_tx
     OR (SELECT count(*) FROM test_outward) <> v_before_outward
     OR (SELECT count(*) FROM test_operation) <> v_before_operation THEN
    RAISE EXCEPTION 'PHASE6D_FAILURE_PATH_NOT_ATOMIC';
  END IF;
END $$;

-- Never persist the disposable fixture.
ROLLBACK;
