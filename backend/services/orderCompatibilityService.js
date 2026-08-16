// Phase 9D Stored Order compatibility helpers.
// Pure functions only. No production DB writes.

function key(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function normalizeOrder(row) {
  const orderQty = Number(row.order_qty ?? 0);
  const shortageQty = Number(row.shortage_qty ?? 0);
  const dispatchQty = Number(row.dispatch_qty ?? 0);
  return {
    plant: key(row.plant),
    sales_document: key(row.sales_document),
    order_date: row.order_date ?? null,
    customer_name: row.customer_name ?? '',
    customer_ref_no: row.customer_ref_no ?? '',
    order_qty: orderQty,
    shortage_qty: shortageQty,
    allocation_remark: row.allocation_remark ?? '',
    shortage_remark: row.shortage_remark ?? '',
    obd: key(row.obd),
    order_status: row.order_status ?? '',
    dispatch_qty: dispatchQty,
    shortage_reason: row.shortage_reason ?? ''
  };
}

function calculateShortage(orderQty, allocatedQty) {
  const order = Number(orderQty ?? 0);
  const allocated = Number(allocatedQty ?? 0);
  return Math.max(order - allocated, 0);
}

function classifyAllocation(orderQty, allocatedQty) {
  const shortage = calculateShortage(orderQty, allocatedQty);
  const order = Number(orderQty ?? 0);
  if (shortage <= 0) return { status: 'OK', shortage_qty: 0 };
  if (allocatedQty > 0 && allocatedQty < order) {
    return { status: 'PARTIAL', shortage_qty: shortage };
  }
  return { status: 'SHORT', shortage_qty: shortage };
}

function resetOrderAllocation(order) {
  const normalized = normalizeOrder(order);
  return {
    ...normalized,
    shortage_qty: 0,
    allocation_remark: '',
    shortage_remark: '',
    order_status: 'PENDING',
    dispatch_qty: 0
  };
}

module.exports = {
  normalizeOrder,
  calculateShortage,
  classifyAllocation,
  resetOrderAllocation
};
