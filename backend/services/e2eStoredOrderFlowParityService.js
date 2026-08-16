/**
 * Phase 8F — Gold-Master end-to-end stored-order flow parity.
 *
 * Pipeline:
 * DISPATCHED register -> stored SO -> FIFO batch allocation -> order update
 * -> SAP_STK_DUMP update -> final state.
 *
 * Pure calculation only. No production writes.
 */
const { allocateStoredOrders, norm, num, parseBatches } = require('./storedOrderBatchParityService');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function normalizeRegister(rows) {
  return (rows || []).map((r, i) => ({
    rowIndex: r.rowIndex || i + 2,
    warehouse: norm(r.warehouse),
    soNumber: norm(r.soNumber || r.so_number || r.so),
    partyName: r.partyName || r.party_name || '',
    destCity: r.destCity || r.dest_city || '',
    soDate: r.soDate || r.so_date || null,
    soTime: r.soTime || r.so_time || '',
    submitTime: r.submitTime || r.submit_time || '',
    obd: String(r.obd || '').trim(),
    pgi: String(r.pgi || '').trim(),
    vehicle: r.vehicle || r.vehicle_number || '',
    driver: r.driver || r.driver_contact || '',
    boxes: num(r.boxes ?? r.total_boxes),
    contractor: r.contractor || r.contractor_name || '',
    supervisor: r.supervisor || r.supervisor_name || '',
    operator: r.operator || r.operator_name || '',
    dispatchStatus: norm(r.dispatchStatus || r.dispatch_status || ''),
    dispatchedAt: r.dispatchedAt || r.dispatched_at || ''
  }));
}

function validateRegisterRow(row) {
  const missing = [];
  for (const key of ['warehouse','soNumber','obd','pgi','vehicle','driver','contractor','supervisor']) {
    if (!String(row[key] ?? '').trim()) missing.push(key);
  }
  if (!(row.boxes >= 0)) missing.push('boxes');
  if (row.dispatchStatus !== 'DISPATCHED') missing.push('dispatchStatus=DISPATCHED');
  return missing;
}

function buildStoredOrders(registerRows, orders) {
  const bySo = new Map((orders || []).map(o => [norm(o.soNumber || o.so_number), clone(o)]));
  const selected = [];
  const rejected = [];
  for (const row of normalizeRegister(registerRows)) {
    const errors = validateRegisterRow(row);
    const order = bySo.get(row.soNumber);
    if (!order) errors.push('storedOrder');
    if (errors.length) { rejected.push({soNumber: row.soNumber, errors}); continue; }
    selected.push({
      ...order,
      soNumber: row.soNumber,
      obd: row.obd,
      pgi: row.pgi,
      vehicle: row.vehicle,
      driver: row.driver,
      boxes: row.boxes,
      contractor: row.contractor,
      supervisor: row.supervisor,
      operator: row.operator,
      remark: order.remark || ''
    });
  }
  return {selected, rejected};
}

function applyDumpUpdates(originalRows, finalDumpRows) {
  const updates = new Map((finalDumpRows || []).map(r => [Number(r.rowIndex), r]));
  return (originalRows || []).map((r, i) => {
    const rowIndex = Number(r.rowIndex || i + 2);
    const u = updates.get(rowIndex);
    return u ? clone(u) : clone(r);
  });
}

function runE2EStoredOrderFlow({warehouse, registerRows, orders, dumpRows, isManualAllocation=false, globalPgi='', timestamp=''}) {
  const wh = norm(warehouse);
  const selected = buildStoredOrders(registerRows, orders);
  const allocation = allocateStoredOrders({
    warehouse: wh,
    orders: selected.selected,
    dumpRows,
    isManualAllocation,
    globalPgi,
    timestamp
  });

  const orderUpdates = Object.values(allocation.results).map(r => ({
    soNumber: r.soNumber,
    status: r.status,
    remark: r.remark,
    pgi: r.pgi,
    clearLines: clone(r.clearLines),
    shortLines: clone(r.shortLines),
    batchAllocations: clone(r.batchAllocations)
  }));

  const finalDumpRows = applyDumpUpdates(dumpRows, allocation.dump.map(x => ({
    rowIndex: x.rowIndex,
    warehouse: x.warehouse,
    sloc: x.sloc,
    material: x.material,
    desc: x.desc,
    batches: x.batches,
    totalUnrestricted: x.totalUnrestricted,
    totalTransit: x.totalTransit
  })));

  const dispatched = normalizeRegister(registerRows).filter(r => r.warehouse === wh && r.dispatchStatus === 'DISPATCHED');
  return {
    status: 'DONE',
    warehouse: wh,
    dispatchedCount: dispatched.length,
    selectedCount: selected.selected.length,
    rejected: selected.rejected,
    orderUpdates,
    finalDumpRows,
    finalDumpRowsForSheet: finalDumpRows.map(r => [r.warehouse,r.sloc,r.material,r.desc,JSON.stringify(parseBatches(r.batches)),num(r.totalUnrestricted),num(r.totalTransit)]),
    invariants: {
      noNegativeStock: finalDumpRows.every(r => num(r.totalUnrestricted) >= 0 && parseBatches(r.batches).every(b => num(b.qty) >= 0)),
      allocatedNotAboveRequested: orderUpdates.every(o => {
        const allocated = o.clearLines.reduce((s,x) => s + num(x.qty), 0);
        const requested = (selected.selected.find(x => norm(x.soNumber) === o.soNumber)?.lines || []).reduce((s,x) => s + num(x.qty), 0);
        return allocated <= requested;
      }),
      batchRemarkWritten: orderUpdates.every(o => o.status === 'NO_LINES' || o.batchAllocations.length === 0 || o.remark.includes('BATCH'))
    }
  };
}

module.exports = { normalizeRegister, validateRegisterRow, buildStoredOrders, applyDumpUpdates, runE2EStoredOrderFlow };
