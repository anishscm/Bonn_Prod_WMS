-- PHASE 8G — READ-ONLY PRODUCTION SCHEMA VERIFICATION
-- Run in Supabase SQL Editor. These queries do NOT INSERT/UPDATE/DELETE data.

-- 1) Exact columns/types/defaults/nullability for the two unresolved tables.
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
WHERE c.table_schema = 'wms'
  AND c.table_name IN ('sap_stk_dump', 'clear_order')
ORDER BY c.table_name, c.ordinal_position;

-- 2) Primary/unique/foreign/check constraints for the same tables.
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'wms'
  AND tc.table_name IN ('sap_stk_dump', 'clear_order')
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- 3) Index definitions / update predicates.
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'wms'
  AND tablename IN ('sap_stk_dump', 'clear_order')
ORDER BY tablename, indexname;

-- 4) RLS state.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wms'
  AND c.relname IN ('sap_stk_dump', 'clear_order')
ORDER BY c.relname;

-- 5) RLS policies.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'wms'
  AND tablename IN ('sap_stk_dump', 'clear_order')
ORDER BY tablename, policyname;
