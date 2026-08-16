/**
 * Phase 8E — Gold-Master DISPATCHED / Outward Register mapping parity.
 *
 * Source contract verified from the production Dispatch UI:
 * ocGetDispatchList() returns the dispatch-register objects consumed by the
 * UI, and ocDispatchOrder() supplies the dispatch completion fields.
 *
 * This module is deliberately calculation/mapping-only. It does not write
 * PostgreSQL production data.
 */

function norm(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function upper(v) { return norm(v).toUpperCase(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

const REGISTER_FIELDS = [
  'warehouse', 'so_number', 'party_name', 'dest_city', 'so_date', 'so_time',
  'submit_time', 'obd', 'pgi', 'vehicle_number', 'driver_contact', 'total_boxes',
  'contractor_name', 'supervisor_name', 'operator_name', 'dispatch_status',
  'dispatched_at'
];

function normalizeDispatchRecord(order, warehouse) {
  const o = order || {};
  const wh = upper(warehouse || o.warehouse);
  const status = upper(o.dispatchStatus || o.dispatch_status || 'PENDING');

  if (!wh) return { status: 'INVALID_WAREHOUSE', error: 'Warehouse is required' };
  if (!/^\d{6,}$/.test(norm(o.soNumber || o.so_number))) {
    return { status: 'INVALID_SO', error: 'SO Number must be at least 6 numeric digits' };
  }
  if (status !== 'PENDING' && status !== 'DISPATCHED') {
    return { status: 'INVALID_STATUS', error: 'Dispatch status must be PENDING or DISPATCHED' };
  }

  const row = {
    warehouse: wh,
    so_number: norm(o.soNumber || o.so_number),
    party_name: norm(o.party || o.partyName || o.party_name),
    dest_city: norm(o.dest || o.destCity || o.dest_city),
    so_date: o.soDate || o.so_date || null,
    so_time: norm(o.soTime || o.so_time),
    submit_time: norm(o.submitTime || o.submit_time),
    obd: norm(o.obd),
    pgi: norm(o.pgi),
    vehicle_number: norm(o.vehNumber || o.vehicleNumber || o.vehicle_number),
    driver_contact: norm(o.driverContact || o.driver_contact),
    total_boxes: num(o.totalBoxes ?? o.totalQty ?? o.total_boxes),
    contractor_name: norm(o.contractorName || o.contractor || o.contractor_name),
    supervisor_name: norm(o.supervisorName || o.supervisor || o.supervisor_name),
    operator_name: norm(o.operatorName || o.operator || o.operator_name),
    dispatch_status: status,
    dispatched_at: norm(o.dispatchedAt || o.dispatched_at)
  };

  return { status: 'DONE', row, fields: REGISTER_FIELDS.slice() };
}

function mapDispatchList(orders, warehouse) {
  return (orders || []).map(o => normalizeDispatchRecord(o, warehouse));
}

function buildDispatchCompletion(input, warehouse) {
  const result = normalizeDispatchRecord({
    ...input,
    dispatchStatus: 'DISPATCHED',
    dispatchedAt: input && input.dispatchedAt ? input.dispatchedAt : input && input.dispatchDate
  }, warehouse);
  if (result.status !== 'DONE') return result;
  if (!result.row.obd || !/^\d{8}$/.test(result.row.obd)) {
    return { status: 'INVALID_OBD', error: 'OBD must be exactly 8 digits' };
  }
  if (!result.row.pgi || !/^\d{10}$/.test(result.row.pgi)) {
    return { status: 'INVALID_PGI', error: 'PGI must be exactly 10 digits' };
  }
  if (!result.row.vehicle_number) return { status: 'INVALID_VEHICLE', error: 'Vehicle number is required' };
  if (!/^\d{10}$/.test(result.row.driver_contact)) {
    return { status: 'INVALID_DRIVER_CONTACT', error: 'Driver contact must be exactly 10 digits' };
  }
  if (result.row.total_boxes <= 0) return { status: 'INVALID_BOX_QTY', error: 'Dispatch quantity/boxes must be positive' };
  if (!result.row.contractor_name) return { status: 'INVALID_CONTRACTOR', error: 'Contractor name is required' };
  if (!result.row.supervisor_name) return { status: 'INVALID_SUPERVISOR', error: 'Supervisor name is required' };
  return result;
}

module.exports = {
  REGISTER_FIELDS,
  normalizeDispatchRecord,
  mapDispatchList,
  buildDispatchCompletion
};
