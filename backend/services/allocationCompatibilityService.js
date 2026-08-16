// Phase 9D Allocation compatibility helpers.
// Pure functions only: no database writes and no production side effects.

function key(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function normalizeAllocation(row) {
  return {
    warehouse: key(row.warehouse),
    so_number: key(row.so_number),
    so_date: row.so_date ?? null,
    party_name_dest_city_name: row.party_name_dest_city_name ?? '',
    reference: row.reference ?? '',
    sku: key(row.sku),
    inhand_alloc: Number(row.inhand_alloc ?? 0),
    transit_alloc: Number(row.transit_alloc ?? 0),
    updated_by: row.updated_by ?? null
  };
}

function allocationTotals(rows, soNumber, sku) {
  const so = key(soNumber);
  const material = key(sku);
  return rows
    .map(normalizeAllocation)
    .filter(r => r.so_number === so && (!material || r.sku === material))
    .reduce((acc, r) => ({
      inhand_alloc: acc.inhand_alloc + r.inhand_alloc,
      transit_alloc: acc.transit_alloc + r.transit_alloc
    }), { inhand_alloc: 0, transit_alloc: 0 });
}

function resetAllocationRows(rows, soNumber) {
  const so = key(soNumber);
  return rows.filter(r => key(r.so_number) !== so);
}

module.exports = { normalizeAllocation, allocationTotals, resetAllocationRows };
