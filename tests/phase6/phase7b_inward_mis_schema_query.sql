-- Phase 7B: extract the real production INWARD_MIS contract.
-- READ-ONLY. Run in the target Supabase project.
SELECT
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'wms'
  AND c.table_name = 'inward_mis'
ORDER BY c.ordinal_position;

-- Also extract constraints/indexes that may affect the production write path.
SELECT
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'wms'
  AND tc.table_name = 'inward_mis'
ORDER BY tc.constraint_name, kcu.ordinal_position;
