// Phase 9D Outbound compatibility helpers.
// Pure functions only. No production DB writes.

function key(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function qty(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error('Invalid quantity');
  return n;
}

function normalizePhysicalStock(row) {
  return {
    id: row.id ?? null,
    mfg_month: row.mfg_month ?? '',
    bin: key(row.bin),
    sku: key(row.sku),
    product_name: row.product_name ?? '',
    qty: qty(row.qty),
    plant: key(row.plant),
    status: row.status ?? ''
  };
}

// FIFO ordering is oldest MFG month first; ties are made deterministic by bin/id.
function sortFifo(rows) {
  return rows
    .map(normalizePhysicalStock)
    .sort((a, b) => {
      const mfg = String(a.mfg_month).localeCompare(String(b.mfg_month));
      if (mfg !== 0) return mfg;
      const bin = a.bin.localeCompare(b.bin);
      if (bin !== 0) return bin;
      return Number(a.id ?? 0) - Number(b.id ?? 0);
    });
}

function allocateFifo(rows, requiredQty) {
  let remaining = qty(requiredQty);
  if (remaining < 0) throw new Error('Required quantity cannot be negative');

  const allocations = [];
  for (const row of sortFifo(rows)) {
    if (remaining <= 0) break;
    if (row.qty <= 0) continue;
    const picked = Math.min(row.qty, remaining);
    allocations.push({
      stock_id: row.id,
      sku: row.sku,
      bin: row.bin,
      mfg_month: row.mfg_month,
      allocated_qty: picked
    });
    remaining -= picked;
  }

  return {
    allocations,
    allocated_qty: qty(requiredQty) - remaining,
    shortage_qty: remaining
  };
}

function validateDeduction(row, deductionQty) {
  const available = qty(row.qty);
  const deduction = qty(deductionQty);
  if (deduction <= 0) throw new Error('Deduction quantity must be positive');
  if (deduction > available) throw new Error('Insufficient physical stock');
  return available - deduction;
}

module.exports = {
  normalizePhysicalStock,
  sortFifo,
  allocateFifo,
  validateDeduction
};
