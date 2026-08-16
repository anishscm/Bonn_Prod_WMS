// Phase 9D stock/allocation compatibility boundary.
// Read-only contract layer; no production writes.

function normalizeKey(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function normalizeStockRow(row) {
  return {
    warehouse: normalizeKey(row.warehouse),
    s_loc: row.s_loc == null ? null : String(row.s_loc).trim(),
    material: normalizeKey(row.material),
    material_description: row.material_description == null ? '' : String(row.material_description),
    batch_qty: row.batch_qty == null ? null : Number(row.batch_qty),
    total_unrestricted: row.total_unrestricted == null ? 0 : Number(row.total_unrestricted),
    total_transit: row.total_transit == null ? 0 : Number(row.total_transit)
  };
}

function normalizeAllocationRow(row) {
  return {
    warehouse: normalizeKey(row.warehouse),
    so_number: normalizeKey(row.so_number),
    sku: normalizeKey(row.sku),
    inhand_alloc: row.inhand_alloc == null ? 0 : Number(row.inhand_alloc),
    transit_alloc: row.transit_alloc == null ? 0 : Number(row.transit_alloc)
  };
}

function buildStockSnapshot(rows) {
  return (rows || []).map(normalizeStockRow).sort((a, b) =>
    `${a.warehouse}|${a.material}|${a.s_loc || ''}`.localeCompare(`${b.warehouse}|${b.material}|${b.s_loc || ''}`)
  );
}

function buildAllocationSnapshot(rows) {
  return (rows || []).map(normalizeAllocationRow).sort((a, b) =>
    `${a.warehouse}|${a.so_number}|${a.sku}`.localeCompare(`${b.warehouse}|${b.so_number}|${b.sku}`)
  );
}

module.exports = {
  normalizeStockRow,
  normalizeAllocationRow,
  buildStockSnapshot,
  buildAllocationSnapshot
};
