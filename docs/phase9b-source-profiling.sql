-- Phase 9B — Source Data Profiling
-- READ-ONLY. Run against a disposable/source export database only.
-- No INSERT / UPDATE / DELETE is included.

-- Expected source logical objects from the Gold Master:
-- SAP_STK_DUMP, SAP_STK_ALLOCATION, Partial Clear Orders,
-- Shortage in Partial Clear Orders, Clear Order, ORDER_CHECKER,
-- WH_MASTERS, BIN_MASTERS, SKU_MASTERS, PARTY_MASTER, MAIL_ID_MASTERS,
-- BIN_TXIN, PHY_STK_ENTRY, PHY_STK_ALLOCATION, Operation_Sheet,
-- Outward_MIS, CCI, ACTIVITY_LOG, ASN, INWARD_MIS.

-- 1. Profile every supplied target table when data has been loaded.
-- Replace the table list with the actual source-export table names if needed.

-- 2. Required key/quality checks for the major stock/order sources:
-- SAP stock: warehouse + material
-- Physical stock: MFG month + BIN + SKU
-- Physical allocation: warehouse + SO + SKU + BIN + MFG month
-- Clear order: warehouse + SO
-- SAP allocation: warehouse + SO + SKU

-- 3. Migration safety rules:
-- a) Preserve text status values and JSON payloads.
-- b) Preserve warehouse scoping.
-- c) Do not deduplicate rows unless the Gold Master proves the row is duplicate.
-- d) Do not transform quantities or dates merely for normalization.
-- e) Produce a rejected-row report for NULL/invalid business keys.
-- f) Keep source row identifiers so every migrated row is traceable.
-- g) Dry-run must report counts and validation failures without writing.

-- 4. Dual-run acceptance criteria:
-- source row count = staged row count + rejected row count
-- accepted row count = imported row count
-- key collision count is explicitly reported
-- numeric quantities are unchanged
-- JSON payloads parse without semantic modification
-- status strings are unchanged
-- warehouse and SO/SKU relationships remain intact

-- 5. Cutover remains blocked until the source export is actually profiled.
