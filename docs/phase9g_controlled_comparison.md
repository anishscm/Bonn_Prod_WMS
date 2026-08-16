# Phase 9G — Controlled GAS-vs-SQL comparison

Phase 9G adds a deterministic comparison harness for validating PostgreSQL behavior against the Google Apps Script (GAS) Gold Master without enabling production SQL writes.

## Compared dimensions

- Response parity: returned RPC/function response.
- Post-operation state parity: relevant state snapshot after the operation.

## Safety boundary

The harness is adapter-only. It has no GAS invocation, database connection, credentials, or production writer. Both sides are injected capture adapters.

## Capture contract

Each adapter returns an object containing `response` and `state`. Object keys are canonicalized before comparison. Array order is preserved because ordering may be semantically significant in WMS outputs.

## Mismatch output

The comparator returns `responseMatched`, `stateMatched`, `matched`, `responseDiffs`, and `stateDiffs`. Each mismatch includes a deterministic JSON path and classification such as `VALUE_MISMATCH`, `MISSING_IN_GAS`, or `MISSING_IN_SQL`.

## Controlled procedure

1. Select a fixed, non-production fixture for a verified Gold-Master workflow.
2. Run the fixture through a read/capture-only GAS adapter.
3. Run the equivalent fixture through a non-production SQL adapter.
4. Capture response and relevant post-operation state from both sides.
5. Compare with `compareCaptures()`.
6. Investigate every mismatch and preserve the fixture/result as review evidence.

A passing fixture does not authorize production writes. Critical workflows still require representative fixtures, parity tests, transaction/rollback coverage where applicable, and explicit production enablement review.

## Exclusions

- No live production data mutation.
- No automatic Supabase/PostgreSQL writes.
- GAS remains the Gold Master / rollback system.
- Distinct Gold-Master operations remain separate, including `opConfirmOutboundDeductStock()` and `opDeductBatchPickingAndMIS()`.
