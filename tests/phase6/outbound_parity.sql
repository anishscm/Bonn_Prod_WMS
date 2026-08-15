-- PHASE 6 disposable outbound parity fixture
-- DO NOT RUN against production data.
-- This fixture assumes the Phase 6B compatibility schema is installed in a disposable DB.

BEGIN;

-- Isolated test SKU/bin. Values are deliberately synthetic.
INSERT INTO wms.phy_stk_entry (mfg_month, bin, sku, product_name, qty, computation_logic, plant, status)
VALUES ('2026-08', 'TEST-FG01', 'TEST-SKU-P6', 'BONN TEST SKU', 100, 'PHASE6_TEST', 'BB04', 'Active');

INSERT INTO wms.phy_stk_allocation (warehouse, so_number, sku, inhand_alloc, transit_alloc)
VALUES ('BB04', 'TEST-SO-P6', 'TEST-SKU-P6', 20, 0);

-- Expected transaction contract:
-- requested deduction = 10
-- physical stock after = 90
-- inhand allocation after = 10 (if this deduction is tied to the allocation)
-- one BIN_TXIN movement must exist for the deducted quantity.

SELECT 'FIXTURE_READY' AS status;

ROLLBACK;
