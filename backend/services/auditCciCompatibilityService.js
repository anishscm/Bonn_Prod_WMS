// Phase 9D Audit / CCI / BIN transaction compatibility helpers.
// Pure functions only. No production DB writes.

function key(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function num(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error('Invalid quantity');
  return n;
}

function buildBinTransaction({ warehouse, bin, sku, qty, batch, transactionType, docNumber, userId, eventTimestamp = null }) {
  const amount = num(qty);
  if (amount === 0) throw new Error('BIN transaction quantity cannot be zero');
  if (!transactionType) throw new Error('transactionType is required');
  return {
    warehouse: key(warehouse),
    event_timestamp: eventTimestamp,
    bin: key(bin),
    sku: key(sku),
    qty: amount,
    batch: batch ?? '',
    transaction_type: String(transactionType).trim().toUpperCase(),
    doc_number: docNumber ?? '',
    user_id: userId ?? null
  };
}

function calculateCciVariance(systemQty, physicalQty) {
  return num(physicalQty) - num(systemQty);
}

function classifyCciVariance(systemQty, physicalQty, tolerance = 0) {
  const variance = calculateCciVariance(systemQty, physicalQty);
  const limit = Math.abs(num(tolerance));
  if (Math.abs(variance) <= limit) return { status: 'MATCH', variance };
  return {
    status: variance > 0 ? 'EXCESS' : 'SHORT',
    variance
  };
}

function buildAuditEvent({ eventType, entityType, entityId, userId, payload = {}, eventTimestamp = null }) {
  if (!eventType) throw new Error('eventType is required');
  if (!entityType) throw new Error('entityType is required');
  return {
    event_type: String(eventType).trim().toUpperCase(),
    entity_type: String(entityType).trim().toUpperCase(),
    entity_id: entityId == null ? null : String(entityId),
    user_id: userId ?? null,
    event_timestamp: eventTimestamp,
    payload
  };
}

module.exports = {
  buildBinTransaction,
  calculateCciVariance,
  classifyCciVariance,
  buildAuditEvent
};
