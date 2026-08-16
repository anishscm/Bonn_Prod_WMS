# Phase 8E — DISPATCHED / Outward Register Compatibility

## Gold-Master evidence

The production Dispatch UI loads the register through `ocGetDispatchList(activeWarehouse)` and consumes the following order fields: SO number, party, destination, SO date/time, submit time, OBD, PGI, total lines/quantity and dispatch status. The dispatched-state renderer additionally consumes dispatch timestamp, vehicle number, driver contact, contractor, supervisor and operator. The dispatch action validates OBD, PGI, vehicle, driver contact, total boxes, contractor and supervisor before calling `ocDispatchOrder(...)`.

The production UI therefore gives a stable 17-field register contract when warehouse scope is included:

1. warehouse
2. SO number
3. party name
4. destination city
5. SO date
6. SO time
7. submit time
8. OBD
9. PGI
10. vehicle number
11. driver contact
12. total boxes / dispatch quantity
13. contractor name
14. supervisor name
15. operator name
16. dispatch status
17. dispatched-at timestamp

## PostgreSQL compatibility mapping

| Gold-Master concept | PostgreSQL compatibility column |
|---|---|
| Active warehouse | `warehouse` |
| SO Number | `so_number` |
| Party | `party_name` |
| Dest | `dest_city` |
| SO Date | `so_date` |
| SO Time | `so_time` |
| Submit Time | `submit_time` |
| OBD | `obd` |
| PGI | `pgi` |
| Vehicle | `vehicle_number` |
| Driver Contact | `driver_contact` |
| Dispatch Qty / Boxes | `total_boxes` |
| Contractor | `contractor_name` |
| Supervisor | `supervisor_name` |
| Operator | `operator_name` |
| Status | `dispatch_status` |
| Dispatch Timestamp | `dispatched_at` |

The proposed table is `wms.dispatched_register_compat`.

## Validation parity

The compatibility service validates the same operational constraints exposed by the production UI for dispatch completion:

- SO number is numeric and at least six digits.
- OBD is exactly eight digits.
- PGI is exactly ten digits.
- Vehicle number is mandatory.
- Driver contact is exactly ten digits.
- Total boxes/dispatch quantity is positive.
- Contractor is mandatory.
- Supervisor is mandatory.
- Dispatch status is `PENDING` or `DISPATCHED`.

## Relationship to Phase 8D

Phase 8D required this source-register contract because `ocAllocateStoredOrders` operates only on orders that exist in the warehouse's Dispatched/Outward Register. Phase 8E supplies the missing PostgreSQL compatibility representation so that a future end-to-end gate can prove:

`DISPATCHED source row -> stored-order lookup -> FIFO batch deduction -> order update -> DUMP update`

## Safety boundary

This phase adds only a compatibility schema and deterministic mapping tests. It does **not** enable production SQL writes, migrate live DISPATCHED data, or replace GAS as the Gold Master.
