# Phase 6D PostgreSQL transaction gate

This gate runs against a disposable PostgreSQL 16 service in GitHub Actions. The SQL creates only temporary tables and always ends with ROLLBACK.

A green result proves transaction mechanics and the required inventory invariants. It does not yet prove real GAS-to-WMS schema parity.

Next gate: execute the real WMS transaction service against a disposable copy of the WMS schema and compare its before/after state with the GAS Gold Master fixture.