# Phase 6E — Controlled GAS Outbound Capture

## Purpose

This is the final Gold-Master comparison step before PostgreSQL production cutover. GAS remains the source of truth.

Do **not** use a real customer order or real stock. Use a disposable/test SKU, test SO and test OBD in a controlled copy/test dataset.

## Capture exactly two snapshots

### 1. GAS response

Execute the existing outbound confirmation flow for the controlled test case and record the exact returned object/message.

The existing frontend calls the GAS function:

`opConfirmOutboundDeductStock(payload)`

Save the returned value as `gas.json` under the `response` key.

### 2. GAS post-operation state

Immediately after the operation, export the affected rows for the same controlled identifiers from:

- `phy_stk_entry`
- `phy_stk_allocation`
- `bin_txin`
- `sap_stk_dump`
- `operation_sheet`
- `outward_mis`

Only include rows affected by the controlled test transaction. Do not export unrelated production data.

Example shape:

```json
{
  "response": {},
  "post_operation_state": {
    "phy_stk_entry": [],
    "phy_stk_allocation": [],
    "bin_txin": [],
    "sap_stk_dump": [],
    "operation_sheet": [],
    "outward_mis": []
  }
}
```

## SQL capture

Run the same controlled input against the PostgreSQL transaction service using the same starting quantities, identifiers and payload. Save the SQL response and the same six post-operation snapshots as `sql.json`.

## Compare

Run:

```bash
node tests/phase6/compare_outbound_capture.js gas.json sql.json
```

Expected result:

```json
{
  "status": "PASS",
  "compared": {
    "response": true,
    "post_operation_state": [
      "phy_stk_entry",
      "phy_stk_allocation",
      "bin_txin",
      "sap_stk_dump",
      "operation_sheet",
      "outward_mis"
    ]
  },
  "mismatches": []
}
```

## Gate rules

- Response mismatch = FAIL.
- Any physical stock mismatch = FAIL.
- Any allocation mismatch = FAIL.
- Any BIN_TXIN mismatch = FAIL.
- Any SAP stock mismatch = FAIL.
- Any Operation Sheet mismatch = FAIL.
- Any Outward MIS mismatch = FAIL.
- Do not approve production cutover from a response-only match.
- Do not mark PASS when a required capture is missing.

After a PASS, repeat the same controlled comparison for at least one shortage/rollback scenario before production cutover.
