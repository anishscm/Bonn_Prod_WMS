// Phase 9D Dispatch/MIS compatibility helpers.
// Pure functions only. No production DB writes.

function key(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function num(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error('Invalid quantity');
  return n;
}

function normalizeDispatchLine(row) {
  return {
    plant: key(row.plant),
    sales_document: key(row.sales_document),
    order_date: row.order_date ?? null,
    customer_name: row.customer_name ?? '',
    customer_ref_no: row.customer_ref_no ?? '',
    obd: key(row.obd),
    sku: key(row.sku),
    description: row.description ?? '',
    batch: row.batch ?? '',
    pgi_qty: num(row.pgi_qty),
    dispatch_qty: num(row.dispatch_qty),
    shortage_qty: num(row.shortage_qty),
    shortage_reason: row.shortage_reason ?? '',
    vehicle_number: key(row.vehicle_number),
    driver_number: row.driver_number ?? '',
    tpt_name: row.tpt_name ?? ''
  };
}

function buildOutwardMisLines(lines, context = {}) {
  const ctx = {
    plant: key(context.plant),
    sales_document: key(context.sales_document),
    order_date: context.order_date ?? null,
    customer_name: context.customer_name ?? '',
    customer_ref_no: context.customer_ref_no ?? '',
    obd: key(context.obd),
    vehicle_number: key(context.vehicle_number),
    driver_number: context.driver_number ?? '',
    tpt_name: context.tpt_name ?? ''
  };
  return lines.map(line => normalizeDispatchLine({ ...ctx, ...line }));
}

function summarizeDispatch(lines) {
  return lines.reduce((acc, raw) => {
    const line = normalizeDispatchLine(raw);
    acc.pgi_qty += line.pgi_qty;
    acc.dispatch_qty += line.dispatch_qty;
    acc.shortage_qty += line.shortage_qty;
    acc.lines += 1;
    return acc;
  }, { lines: 0, pgi_qty: 0, dispatch_qty: 0, shortage_qty: 0 });
}

function dispatchStatus(orderQty, dispatchQty) {
  const order = num(orderQty);
  const dispatched = num(dispatchQty);
  if (dispatched <= 0) return 'PENDING';
  if (dispatched < order) return 'PARTIAL';
  return 'DISPATCHED';
}

function buildMovementAudit(line, movementType = 'OUTWARD') {
  const normalized = normalizeDispatchLine(line);
  return {
    movement_type: movementType,
    sku: normalized.sku,
    batch: normalized.batch,
    qty: normalized.dispatch_qty,
    bin: key(line.bin),
    doc_number: normalized.sales_document || normalized.obd,
    vehicle_number: normalized.vehicle_number
  };
}

module.exports = {
  normalizeDispatchLine,
  buildOutwardMisLines,
  summarizeDispatch,
  dispatchStatus,
  buildMovementAudit
};
