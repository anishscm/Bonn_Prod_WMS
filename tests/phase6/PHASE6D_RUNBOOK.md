# Phase 6D Runbook

1. GitHub Actions starts disposable PostgreSQL 16.
2. `tests/phase6/phase6d_pg_transaction_test.sql` runs with `ON_ERROR_STOP=1`.
3. SQL uses TEMP tables only.
4. Success-path invariants are checked.
5. Failure-path no-mutation invariant is checked.
6. Script ends with ROLLBACK.

No Supabase credentials are used at this stage.