# Phase 6D Gate

The disposable PostgreSQL transaction gate is installed on the phase-6b-inventory-parity branch. It uses PostgreSQL 16 in GitHub Actions, TEMP tables only, validates inventory transaction invariants, and ends with ROLLBACK. No Supabase credentials are required.