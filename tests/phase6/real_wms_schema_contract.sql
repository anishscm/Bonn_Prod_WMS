-- Phase 6E: real WMS schema contract extraction
-- SAFE: read-only metadata query. No table/data changes.
-- Run this in the BONN-Prod-WMS Supabase SQL Editor.
-- Paste the complete result back into the migration workflow before
-- production mappings are finalized. Do NOT guess production column names.

WITH target_tables AS (
  SELECT unnest(ARRAY[
    'phy_stk_entry',
    'phy_stk_allocation',
    'bin_txin',
    'outward_mis',
    'operation_sheet',
    'sap_stk_allocation'
  ]) AS table_name
),
cols AS (
  SELECT
    c.table_schema,
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
  FROM information_schema.columns c
  JOIN target_tables t ON t.table_name = c.table_name
  WHERE c.table_schema = 'wms'
),
pks AS (
  SELECT
    kcu.table_schema,
    kcu.table_name,
    kcu.column_name,
    kcu.ordinal_position
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_schema = tc.constraint_schema
   AND kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'wms'
    AND tc.constraint_type = 'PRIMARY KEY'
),
tables AS (
  SELECT
    t.table_name,
    to_regclass(format('%I.%I', 'wms', t.table_name)) IS NOT NULL AS exists_in_wms
  FROM target_tables t
)
SELECT
  'TABLE' AS record_type,
  table_name,
  NULL::integer AS ordinal_position,
  NULL::text AS column_name,
  NULL::text AS data_type,
  NULL::text AS udt_name,
  NULL::text AS is_nullable,
  NULL::text AS column_default,
  NULL::boolean AS is_primary_key,
  exists_in_wms
FROM tables
UNION ALL
SELECT
  'COLUMN' AS record_type,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  EXISTS (
    SELECT 1 FROM pks
    WHERE pks.table_schema = c.table_schema
      AND pks.table_name = c.table_name
      AND pks.column_name = c.column_name
  ) AS is_primary_key,
  TRUE AS exists_in_wms
FROM cols c
ORDER BY table_name, record_type, ordinal_position NULLS FIRST;
