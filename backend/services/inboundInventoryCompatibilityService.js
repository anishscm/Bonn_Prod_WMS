// Phase 9D Inbound / physical inventory compatibility helpers.
// Pure functions only. No production DB writes.

function key(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function num(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error('Invalid quantity');
  return n;
}

function normalizeInward(row) {
  const billQty = num(row.bill_qty);
  const physicalQty = num(row.phy_qty);
  return {
    plant_code: key(row.plant_code),
    obd_no_mat_doc: key(row.obd_no_mat_doc),
    invoice_num: key(row.invoice_num),
    invoice_date: row.invoice_date ?? null,
    vehicle_no: key(row.vehicle_no),
    material_code: key(row.material_code),
    material_description: row.material_description ?? '',
    billed_batch: key(row.billed_batch),
    bill_qty: billQty,
    phy_batch: key(row.phy_batch),
    phy_qty: physicalQty,
    short_excess: row.short_excess == null ? physicalQty - billQty : num(row.short_excess),
    bin: key(row.bin),
    status: row.status ?? '',
    supervisor_name: row.supervisor_name ?? '',
    deo: row.deo ?? '',
    contractor_name: row.contractor_name ?? '',
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    dock_num: key(row.dock_num),
    shift: row.shift ?? '',
    confirmation_datetime: row.confirmation_datetime ?? null,
    grn_num: key(row.grn_num),
    line_status: row.line_status ?? '',
    unloading_date: row.unloading_date ?? null,
    loading_supervisor_name: row.loading_supervisor_name ?? ''
  };
}

function calculateShortExcess(billQty, physicalQty) {
  return num(physicalQty) - num(billQty);
}

function normalizePhysicalEntry(row) {
  return {
    mfg_month: row.mfg_month ?? '',
    bin: key(row.bin),
    sku: key(row.sku),
    product_name: row.product_name ?? '',
    qty: num(row.qty),
    computation_logic: row.computation_logic ?? '',
    plant: key(row.plant),
    status: row.status ?? ''
  };
}

function consolidatePhysicalEntry(rows, mfgMonth, bin, sku) {
  const m = String(mfgMonth ?? '').trim();
  const b = key(bin);
  const s = key(sku);
  return rows
    .map(normalizePhysicalEntry)
    .filter(r => r.mfg_month === m && r.bin === b && r.sku === s)
    .reduce((total, r) => total + r.qty, 0);
}

module.exports = {
  normalizeInward,
  calculateShortExcess,
  normalizePhysicalEntry,
  consolidatePhysicalEntry
};
