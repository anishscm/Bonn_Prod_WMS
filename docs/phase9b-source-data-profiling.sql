-- BONN WMS Phase 9B: source-data profiling
-- READ-ONLY. Run against an exported/staging copy, not production.

-- 1) Expected source objects from the Gold Master.
-- SAP_STK_DUMP, SAP_STK_ALLOCATION, Partial Clear Orders,
-- Shortage in Partial Clear Orders, Clear Order, ORDER_CHECKER,
-- WH_MASTERS, BIN_MASTERS, SKU_MASTERS, PARTY_MASTER,
-- BIN_TXIN, PHY_STK_ENTRY, PHY_STK_ALLOCATION, Operation_Sheet,
-- Outward_MIS, CCI, ACTIVITY_LOG, ASN, INWARD_MIS.

-- 2) For each imported staging table, profile row count and null density.
-- Replace <table> with a staging table name before execution.
-- SELECT COUNT(*) AS row_count FROM staging.<table>;

-- 3) Duplicate/business-key checks required before import.
-- SAP stock: warehouse + material
-- Clear orders: warehouse + so_number
-- Physical stock: mfg_month + bin + sku
-- Physical allocation: warehouse + so_number + sku + bin + mfg_month

-- 4) Numeric invariants.
-- SAP unrestricted/transit must not become negative.
-- Physical stock qty must not become negative after applying the source semantics.

-- 5) JSON fields must parse before import.
-- Validate Lines JSON / Clear Lines JSON using the target PostgreSQL jsonb parser.

-- 6) Migration must preserve source status strings, timestamps, and identifiers.
-- Do not trim/normalize values unless the Gold Master already does so.

-- 7) Import is blocked until a source export is supplied and profiled.
-- This file intentionally contains no INSERT/UPDATE/DELETE statements.
