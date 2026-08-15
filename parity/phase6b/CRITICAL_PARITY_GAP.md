# Phase 6B — Critical Inventory Parity

## Gold Master finding

The current GAS WMS uses a legacy `Stock_Entry` contract in the inward path. It must not be silently mapped to `PHY_STK_ENTRY` because the two structures and downstream side effects are different.

The Gold Master flow is:

`iwBatchInwardWithMIS` → `saveOrUpdateStock` / Stock_Entry → `INWARD_MIS` updates/appends.

The outbound Gold Master also performs multiple side effects: stock deduction, allocation deletion, `BIN_TXIN` logging, and Operation/Outward updates.

## Required SQL behavior

1. Use one PostgreSQL transaction for each multi-table inventory operation.
2. Lock affected `phy_stk_entry` rows before calculating a deduction.
3. Reject a deduction when the exact requested stock cannot be satisfied unless the Gold Master explicitly allows its fallback behavior.
4. Preserve MFG matching and SKU+BIN+plant fallback behavior from the Gold Master.
5. Write `BIN_TXIN` for every outbound deduction, matching the Gold Master fields.
6. Release matching `phy_stk_allocation` rows only after successful stock deduction.
7. Roll back every side effect if any mandatory step fails.

## Current status

- Source excerpts captured: yes
- Compatibility schema proposed: yes
- Supabase production schema changed: no
- Real data imported: no
- Production cutover: blocked

The proposed compatibility table is intentionally not part of the live database until the parity test is approved.
