# Phase 6C — Deterministic Parity Harness

This phase adds a deterministic inventory transaction harness for the Phase 6B outbound flow.

It validates the invariants independently of Supabase: exact stock decrement, allocation decrement, BIN transaction, outward effect, operation effect, and rejection of insufficient stock.

A real GAS-vs-SQL parity PASS still requires the same captured input and post-operation state from the Gold Master GAS WMS and the PostgreSQL service. Production Supabase is not modified by this harness.
