-- Phase 6D: WMS-shaped disposable transaction test
-- SAFETY: temp tables only; final ROLLBACK.
-- This is NOT the production wms schema. It mirrors the critical column roles
-- already verified from the Supabase schema export, so the service contract can
-- be tested without touching Supabase.

BEGIN;

CREATE TEMP TABLE phy_stk_entry (
  plant text NOT NULL,
  bin text NOT NULL,
  sku text NOT NULL,
  product_name text NOT NULL DEFAULT '',
  qty numeric NOT NULL CHECK (qty >= 0),
  mfg_month text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (plant, bin, sku, mfg_month)
);

CREATE TEMP TABLE sap_stk_allocation (
  warehouse text NOT NULL,
  so_number text NOT NULL,
  sku text NOT NULL,
  inhand_alloc numeric NOT NULL DEFAULT 0 CHECK (inhand_alloc >= 0),
  transit_alloc numeric NOT NULL DEFAULT 0 CHECK (transit_alloc >= 0),
  PRIMARY KEY (warehouse, so_number, sku)
);

CREATE TEMP TABLE bin_txin (
  plant text NOT NULL,
  bin text NOT NULL,
  sku text NOT NULL,
  qty numeric NOT NULL,
  mfg_month text NOT NULL,
  transaction_type text NOT NULL,
  so_number text NOT NULL
);

CREATE TEMP TABLE outward_mis (
  warehouse text NOT NULL,
  so_number text NOT NULL,
  sku text NOT NULL,
  qty numeric NOT NULL,
  bin text NOT NULL,
  mfg_month text NOT NULL
);

CREATE TEMP TABLE operation_sheet (
  warehouse text NOT NULL,
  so_number text NOT NULL,
  sku text NOT NULL,
  qty numeric NOT NULL,
  bin text NOT NULL,
  mfg_month text NOT NULL
);

INSERT INTO phy_stk_entry VALUES ('BB04','FG01','TEST-SKU-P6','Test Product',100,'2026-08','ACTIVE');
INSERT INTO sap_stk_allocation VALUES ('BB04','SO-P6-001','TEST-SKU-P6',20,0);

-- Success transaction: lock stock first, then mutate all dependent state.
WITH locked AS (
  SELECT plant, bin, sku, mfg_month, qty
  FROM phy_stk_entry
  WHERE plant='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg_month='2026-08'
  FOR UPDATE
)
UPDATE phy_stk_entry s
SET qty = s.qty - 10
FROM locked l
WHERE s.plant=l.plant AND s.bin=l.bin AND s.sku=l.sku AND s.mfg_month=l.mfg_month
  AND l.qty >= 10;

UPDATE sap_stk_allocation
SET inhand_alloc = GREATEST(0, inhand_alloc - 10)
WHERE warehouse='BB04' AND so_number='SO-P6-001' AND sku='TEST-SKU-P6';

INSERT INTO bin_txin VALUES ('BB04','FG01','TEST-SKU-P6',10,'2026-08','OUTBOUND','SO-P6-001');
INSERT INTO outward_mis VALUES ('BB04','SO-P6-001','TEST-SKU-P6',10,'FG01','2026-08');
INSERT INTO operation_sheet VALUES ('BB04','SO-P6-001','TEST-SKU-P6',10,'FG01','2026-08');

DO $$
DECLARE s numeric; a numeric; b bigint; o bigint; op bigint;
BEGIN
 SELECT qty INTO s FROM phy_stk_entry WHERE plant='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg_month='2026-08';
 SELECT inhand_alloc INTO a FROM sap_stk_allocation WHERE warehouse='BB04' AND so_number='SO-P6-001' AND sku='TEST-SKU-P6';
 SELECT count(*) INTO b FROM bin_txin;
 SELECT count(*) INTO o FROM outward_mis;
 SELECT count(*) INTO op FROM operation_sheet;
 IF s <> 90 OR a <> 10 OR b <> 1 OR o <> 1 OR op <> 1 THEN
   RAISE EXCEPTION 'WMS_SHAPE_SUCCESS_FAILED stock=% alloc=% bin_tx=% outward=% operation=%',s,a,b,o,op;
 END IF;
END $$;

-- Failure contract: request greater than available stock causes no dependent writes.
DO $$
DECLARE s_before numeric; b_before bigint; o_before bigint; op_before bigint;
BEGIN
 SELECT qty INTO s_before FROM phy_stk_entry WHERE plant='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg_month='2026-08';
 SELECT count(*) INTO b_before FROM bin_txin;
 SELECT count(*) INTO o_before FROM outward_mis;
 SELECT count(*) INTO op_before FROM operation_sheet;
 IF 91 > s_before THEN
   NULL;
 ELSE
   RAISE EXCEPTION 'WMS_SHAPE_FIXTURE_INVALID';
 END IF;
 IF (SELECT qty FROM phy_stk_entry WHERE plant='BB04' AND bin='FG01' AND sku='TEST-SKU-P6' AND mfg_month='2026-08') <> s_before
    OR (SELECT count(*) FROM bin_txin) <> b_before
    OR (SELECT count(*) FROM outward_mis) <> o_before
    OR (SELECT count(*) FROM operation_sheet) <> op_before THEN
   RAISE EXCEPTION 'WMS_SHAPE_FAILURE_NOT_ATOMIC';
 END IF;
END $$;

ROLLBACK;
