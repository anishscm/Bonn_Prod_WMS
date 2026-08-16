/**
 * Phase 8D — Gold-Master ocAllocateStoredOrders FIFO parity.
 *
 * Source: Code_Prod_WMS(2).gs / ocAllocateStoredOrders.
 * This module intentionally models the calculation/state transition only.
 * It does not write production data.
 */

function norm(v) { return String(v ?? '').trim().toUpperCase(); }
function num(v) { const n=Number(v); return Number.isFinite(n)?n:0; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

function parseBatches(value) {
  if (Array.isArray(value)) return clone(value);
  try { const x=JSON.parse(value || '[]'); return Array.isArray(x)?x:[]; } catch (_) { return []; }
}

function normalizeOrders(orders) {
  return (orders || []).map(o => ({
    soNumber:norm(o.soNumber || o.so_number),
    soDate:o.soDate || o.so_date || null,
    soldToParty:o.soldToParty || o.sold_to_party || '',
    partyName:o.partyName || o.party_name || o.sold_to_party_name || '',
    destCity:o.destCity || o.dest_city || o.reference || '',
    lines:typeof o.lines === 'string' ? parseBatches(o.lines) : (o.lines || []),
    remark:String(o.remark || ''),
    obd:String(o.obd || '').trim(),
    pgi:String(o.pgi || '').trim(),
    vehicle:o.vehicle || o.veh || '',
    driver:o.driver || '',
    boxes:o.boxes || '',
    contractor:o.contractor || '',
    supervisor:o.supervisor || '',
    operator:o.operator || ''
  }));
}

function normalizeDump(dumpRows) {
  return (dumpRows || []).map((r,idx) => ({
    rowIndex:r.rowIndex || idx+2,
    warehouse:norm(r.warehouse),
    sloc:r.sloc || r.s_loc || '',
    material:norm(r.material),
    desc:r.desc || r.description || r.material_description || '',
    batches:parseBatches(r.batches ?? r.batch_qty),
    totalUnrestricted:num(r.totalUnrestricted ?? r.total_unrestricted),
    totalTransit:num(r.totalTransit ?? r.total_transit),
    dirty:false
  }));
}

function allocateStoredOrder(order, dump, warehouse, isManualAllocation, globalPgi, timestamp='') {
  const wh=norm(warehouse), so=norm(order.soNumber);
  if (!so) return {status:'INVALID_SO',soNumber:so};
  if (norm(order.remark).indexOf('BATCH') !== -1) return {status:'ALREADY_ALLOCATED',soNumber:so,error:'Already batch pick deducted'};
  const lines=(order.lines || []).map(l=>({sku:norm(l.sku),qty:num(l.qty),desc:l.desc||''})).filter(l=>l.sku && l.qty>0);
  if (!lines.length) return {status:'NO_LINES',soNumber:so,error:'No lines in order'};

  const clearLines=[],shortLines=[],batchAllocations=[];
  for (const line of lines) {
    let remaining=line.qty;
    const skuAllocated=[];
    for (const item of dump) {
      if (remaining<=0) break;
      if (item.warehouse!==wh || item.material!==line.sku) continue;
      const updated=[]; let rowTotal=0;
      for (const original of item.batches) {
        const b=original || {}, bQty=num(b.qty);
        if (bQty<=0) continue;
        if (remaining<=0) { updated.push(b); rowTotal+=bQty; continue; }
        if (bQty<=remaining) {
          skuAllocated.push({batch:b.batch,qty:bQty,sloc:item.sloc});
          remaining-=bQty; item.dirty=true;
        } else {
          const kept=clone(b); kept.qty=bQty-remaining;
          skuAllocated.push({batch:b.batch,qty:remaining,sloc:item.sloc});
          remaining=0; item.dirty=true; updated.push(kept); rowTotal+=kept.qty;
        }
      }
      item.batches=updated; item.totalUnrestricted=rowTotal;
    }
    const allocated=line.qty-remaining;
    if (allocated>0) {
      clearLines.push({sku:line.sku,qty:allocated,desc:line.desc});
      const details=skuAllocated.map(x=>x.batch+'('+x.qty+')').join(',');
      batchAllocations.push(line.sku+'['+details+']');
    }
    if (remaining>0) shortLines.push({sku:line.sku,reqQty:line.qty,desc:line.desc,availInhand:allocated,shortBT:remaining,statusBT:allocated>0?'PARTIAL':'NO STOCK',trnUsed:0,shortAT:remaining,statusAT:allocated>0?'SHORT':'NO STOCK'});
  }

  const isPartial=shortLines.length>0;
  let remark=isPartial?'PARTIAL ALLOCATION':'FULL ALLOCATION';
  if (batchAllocations.length) remark += isManualAllocation?' - BATCH':' - BATCH: '+batchAllocations.join('; ');
  if (String(order.remark).indexOf('(Block)')!==-1) remark += ' (Block)';
  const pgi=(order.pgi||'').toString().trim() || String(globalPgi||'').trim();
  return {
    status:isPartial?'PARTIAL':'DONE',soNumber:so,warehouse:wh,isPartial,remark,pgi,
    clearLines,shortLines,batchAllocations,
    lines:lines.map(l=>({sku:l.sku,qty:l.qty,desc:l.desc||''})),
    timestamp,
    orderUpdates:{allocationRemark:remark,pgi},
    dumpUpdates:dump.filter(x=>x.dirty).map(x=>({rowIndex:x.rowIndex,warehouse:x.warehouse,sloc:x.sloc,material:x.material,desc:x.desc,batches:clone(x.batches),totalUnrestricted:x.totalUnrestricted,totalTransit:x.totalTransit}))
  };
}

function allocateStoredOrders({warehouse,orders,dumpRows,isManualAllocation=false,globalPgi='',timestamp=''}) {
  const dump=normalizeDump(dumpRows), normalized=normalizeOrders(orders), results={};
  for (const order of normalized) {
    const result=allocateStoredOrder(order,dump,warehouse,isManualAllocation,globalPgi,timestamp);
    results[result.soNumber]=result;
  }
  return {status:'DONE',warehouse:norm(warehouse),results,dump:dump.map(x=>({rowIndex:x.rowIndex,warehouse:x.warehouse,sloc:x.sloc,material:x.material,desc:x.desc,batches:clone(x.batches),totalUnrestricted:x.totalUnrestricted,totalTransit:x.totalTransit,dirty:x.dirty})),finalDumpRows:dump.filter(x=>x.totalUnrestricted>0 && x.batches.length>0).map(x=>[x.warehouse,x.sloc,x.material,x.desc,JSON.stringify(x.batches),x.totalUnrestricted,x.totalTransit])};
}

module.exports={norm,num,parseBatches,normalizeOrders,normalizeDump,allocateStoredOrder,allocateStoredOrders};
