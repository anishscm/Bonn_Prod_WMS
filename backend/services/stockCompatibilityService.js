// Phase 9D Stock compatibility layer.
// Read-only contract helpers; no production DB connection or writes.

function normalizeKey(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function normalizeStockRow(row) {
  return {
    warehouse: normalizeKey(row.warehouse),
    s_loc: normalizeKey(row.s_loc),
    material: normalizeKey(row.material),
    material_description: row.material_description ?? '',
    batch_qty: row.batch_qty ?? '',
    total_unrestricted: Number(row.total_unrestricted ?? 0),
    total_transit: Number(row.total_transit ?? 0),
    updated_at: row.updated_at ?? null
  };
}

function buildStockLookup(rows, warehouse, material) {
  const w = normalizeKey(warehouse);
  const m = normalizeKey(material);
  return rows
    .map(normalizeStockRow)
    .filter(row => row.warehouse === w && row.material === m);
}

module.exports = { normalizeKey, normalizeStockRow, buildStockLookup };
