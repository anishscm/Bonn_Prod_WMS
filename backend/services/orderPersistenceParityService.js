/**
 * Phase 8C — Gold-Master order allocation persistence parity.
 * Source: gold-master-Code_Prod_WMS(1).gs:
 * ocSubmitClearOrder, ocSubmitPartialOrder, ocDeletePartialOrder,
 * _buildRawStockMap, _buildAllocMap and _allocateLines.
 *
 * SQL stores the underlying SO value without the Google Sheets leading-
 * apostrophe display marker used by setValues (e.g. 123456, not '123456).
 */

function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase(); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function validSo(v) { return /^\d{6,}$/.test(norm(v)); }
function validObd(v) { const x = String(v ?? '').trim(); return !x || /^\d{8}$/.test(x); }
function validPgi(v) { const x = String(v ?? '').trim(); return !x || /^\d{10}$/.test(x); }

function buildRunningStock(rawStock, allocation) {
  const runInh = {}, runTrn = {}, raw = rawStock || {};
  const alloc = allocation || { inhand:{}, transit:{} };
  Object.keys(raw).forEach(sku => {
    runInh[sku] = Math.max(0, n(raw[sku].sap) - n(alloc.inhand?.[sku]));
    runTrn[sku] = Math.max(0, n(raw[sku].transit) - n(alloc.transit?.[sku]));
  });
  return { runInh, runTrn };
}

function allocateLines(lines, rawStock, runInh, runTrn, warehouse, soNumber, soDate, party, dest, timestamp, userId) {
  const rows = [], wh = norm(warehouse || 'BB04');
  for (const line of (lines || [])) {
    const sku = norm(line?.sku || ''), reqQty = n(line?.qty);
    if (!sku || reqQty <= 0) continue;
    const curInh = n(runInh[sku]), curTrn = n(runTrn[sku]);
    const inhandAlloc = Math.min(curInh, reqQty);
    const shortBT = Math.max(0, reqQty - inhandAlloc);
    const transitAlloc = Math.min(curTrn, shortBT);
    runInh[sku] = Math.max(0, curInh - inhandAlloc);
    runTrn[sku] = Math.max(0, curTrn - transitAlloc);
    if (inhandAlloc > 0 || transitAlloc > 0) rows.push({
      warehouse:wh, eventTimestamp:timestamp, soNumber:norm(soNumber), soDate:soDate || null,
      party:party || '', reference:dest || '', sku, inhandAlloc, transitAlloc, updatedBy:userId || 'admin'
    });
  }
  return rows;
}

function buildLinesToAllocate(payload) {
  const clearLines = Array.isArray(payload?.clearLines) ? payload.clearLines : [];
  const shortLines = Array.isArray(payload?.shortLines) ? payload.shortLines : [];
  const origLines = Array.isArray(payload?.lines) ? payload.lines : [];
  const out = [];
  if (origLines.length) {
    for (const orig of origLines) {
      const sku = norm(orig?.sku), clear = clearLines.find(x => norm(x?.sku) === sku);
      if (clear) { out.push({sku:clear.sku, qty:n(clear.qty), desc:clear.desc || ''}); continue; }
      const sh = shortLines.find(x => norm(x?.sku) === sku);
      if (sh) { const q=n(sh.availInhand)+n(sh.trnUsed); if(q>0) out.push({sku:sh.sku,qty:q,desc:sh.desc||''}); }
    }
  } else {
    clearLines.forEach(l=>out.push({sku:l.sku,qty:n(l.qty),desc:l.desc||''}));
    shortLines.forEach(l=>{const q=n(l.availInhand)+n(l.trnUsed);if(q>0)out.push({sku:l.sku,qty:q,desc:l.desc||''});});
  }
  return out;
}

function buildPartialPlan({warehouse,payload,rawStock,allocation,userId,timestamp}) {
  const so=norm(payload?.soNumber), wh=norm(warehouse||'BB04');
  if(!validSo(so)) return {status:'INVALID_SO',error:'SO Number must be min 6 digits numeric'};
  const obd=String(payload?.obd||'').trim(), pgi=String(payload?.pgi||'').trim();
  if(!validObd(obd)) return {status:'INVALID_OBD',error:'OBD must be exactly 8 digits if entered'};
  if(!validPgi(pgi)) return {status:'INVALID_PGI',error:'PGI must be exactly 10 digits if entered'};
  const soDate=String(payload?.soDate||''),party=norm(payload?.partyName||''),dest=norm(payload?.destCity||''),soldToParty=payload?.soldToParty||'';
  const clearLines=Array.isArray(payload?.clearLines)?payload.clearLines:[], shortLines=Array.isArray(payload?.shortLines)?payload.shortLines:[], origLines=Array.isArray(payload?.lines)?payload.lines:[];
  const linesToAllocate=buildLinesToAllocate(payload), running=buildRunningStock(rawStock,allocation);
  const allocRows=allocateLines(linesToAllocate,rawStock,running.runInh,running.runTrn,wh,so,soDate,party,dest,timestamp,userId);
  const clearJson=JSON.stringify(linesToAllocate.map(l=>({sku:norm(l.sku),qty:n(l.qty),desc:l.desc||''})));
  const allLines=origLines.length?origLines:[...clearLines.map(l=>({sku:l.sku,qty:l.qty,desc:l.desc})),...shortLines.map(l=>({sku:l.sku,qty:l.reqQty,desc:l.desc}))];
  const linesJson=JSON.stringify(allLines.map(l=>({sku:norm(l.sku),desc:l.desc||'',qty:n(l.qty)})));
  const totalOrderQty=allLines.reduce((s,l)=>s+n(l.qty),0);
  let totalTransitUsed=0,totalShortAT=0,totalShortBT=0;
  shortLines.forEach(l=>{const trn=n(l.trnUsed),sat=n(l.shortAT),sbt=n(l.shortBT);totalShortBT+=sbt>0?sbt:trn+sat;totalTransitUsed+=trn;totalShortAT+=sat;});
  const finalRemark=totalShortAT>0?'Partial Allocation':(totalTransitUsed>0?'Full Allocation (Transit)':'Full Allocation (Inhand)');
  return {status:'DONE',warehouse:wh,soNumber:so,soDate,party,dest,soldToParty,obd,pgi,clearLines,shortLines,origLines,linesToAllocate,allocRows,clearJson,linesJson,totalOrderQty,totalShortBT,finalRemark,updatedBy:userId||'admin',timestamp};
}

function buildClearPlan({warehouse,payload,rawStock,allocation,userId,timestamp}) {
  const so=norm(payload?.soNumber),wh=norm(warehouse||'BB04'); if(!validSo(so))return{status:'INVALID_SO'};
  const obd=String(payload?.obd||'').trim(),pgi=String(payload?.pgi||'').trim();
  if(!validObd(obd))return{status:'INVALID_OBD',error:'OBD must be exactly 8 digits if entered'};
  if(!validPgi(pgi))return{status:'INVALID_PGI',error:'PGI must be exactly 10 digits'};
  const soDate=String(payload?.soDate||''),party=norm(payload?.partyName||''),dest=norm(payload?.destCity||''),soldToParty=payload?.soldToParty||'';
  const lines=Array.isArray(payload?.lines)?payload.lines:[],running=buildRunningStock(rawStock,allocation);
  const allocRows=allocateLines(lines,rawStock,running.runInh,running.runTrn,wh,so,soDate,party,dest,timestamp,userId);
  const linesJson=JSON.stringify(lines.map(l=>({sku:norm(l.sku),qty:n(l.qty),desc:l.desc||''}))),totalOrderQty=lines.reduce((s,l)=>s+n(l.qty),0);
  let totalTransitQty=0,transitRemarks=[]; allocRows.forEach(r=>{if(n(r.transitAlloc)>0){totalTransitQty+=n(r.transitAlloc);transitRemarks.push(norm(r.sku)+'('+n(r.transitAlloc)+')');}});
  return {status:'DONE',warehouse:wh,soNumber:so,soDate,party,dest,soldToParty,obd,pgi,lines,allocRows,linesJson,totalOrderQty,totalTransitQty,remark:totalTransitQty>0?'Full Allocation (Transit)':'Full Allocation (Inhand)',shortageRemark:transitRemarks.join(', '),updatedBy:userId||'admin',timestamp};
}

async function loadStock(client,warehouse){
  const wh=norm(warehouse||'BB04');
  const rawRes=await client.query(`SELECT material,material_description,COALESCE(SUM(total_unrestricted),0) sap,COALESCE(SUM(total_transit),0) transit FROM wms.sap_stk_dump WHERE UPPER(TRIM(warehouse))=$1 GROUP BY material,material_description`,[wh]);
  const raw={}; for(const r of rawRes.rows){const sku=norm(r.material);if(sku)raw[sku]={sap:n(r.sap),transit:n(r.transit),desc:String(r.material_description||'').trim()};}
  const aRes=await client.query(`SELECT sku,COALESCE(SUM(inhand_alloc),0) inhand_alloc,COALESCE(SUM(transit_alloc),0) transit_alloc FROM wms.sap_stk_allocation WHERE UPPER(TRIM(warehouse))=$1 GROUP BY sku`,[wh]);
  const allocation={inhand:{},transit:{}}; for(const r of aRes.rows){const sku=norm(r.sku);allocation.inhand[sku]=n(r.inhand_alloc);allocation.transit[sku]=n(r.transit_alloc);}
  return {raw,allocation};
}

async function deleteOrderRows(client,soNumber,deleteOutward=true){
  const so=norm(soNumber),removed={partial:0,shortage:0,alloc:0,orders:0,outward:0};
  for(const [key,table] of [['partial','partial_clear_orders'],['shortage','shortage_partial_orders'],['alloc','sap_stk_allocation'],['orders','clear_order']]){const r=await client.query(`DELETE FROM wms.${table} WHERE UPPER(TRIM(so_number))=$1`,[so]);removed[key]=r.rowCount;}
  if(deleteOutward){const r=await client.query(`DELETE FROM wms.order_checker WHERE UPPER(TRIM(sale_document))=$1`,[so]);removed.outward=r.rowCount;}
  return removed;
}

async function existsOrder(client,warehouse,so){
  const wh=norm(warehouse),s=norm(so); const checks=await Promise.all([
    client.query(`SELECT 1 FROM wms.clear_order WHERE UPPER(TRIM(warehouse))=$1 AND UPPER(TRIM(so_number))=$2 LIMIT 1`,[wh,s]),
    client.query(`SELECT 1 FROM wms.partial_clear_orders WHERE UPPER(TRIM(warehouse))=$1 AND UPPER(TRIM(so_number))=$2 LIMIT 1`,[wh,s]),
    client.query(`SELECT 1 FROM wms.order_checker WHERE UPPER(TRIM(plant))=$1 AND UPPER(TRIM(sale_document))=$2 LIMIT 1`,[wh,s])
  ]); return checks.some(r=>r.rows.length>0);
}

async function writeAllocations(client,rows){for(const r of rows)await client.query(`INSERT INTO wms.sap_stk_allocation (warehouse,event_timestamp,so_number,so_date,party_name_dest_city_name,reference,sku,inhand_alloc,transit_alloc,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[r.warehouse,r.eventTimestamp,r.soNumber,r.soDate,r.party,r.reference,r.sku,r.inhandAlloc,r.transitAlloc,r.updatedBy]);}
async function writeOrderChecker(client,args){await client.query(`INSERT INTO wms.order_checker (sale_document,document_date,sold_to_party,sold_to_party_name,customer_reference,lines_json,plant,total_order_qty,shortage_qty,allocation_remark,shortage_remark) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,args);}

async function getFreshStock(client,warehouse){
  const wh=norm(warehouse||'BB04'); const {rows}=await client.query(`SELECT d.material,d.material_description,COALESCE(SUM(d.total_unrestricted),0) sap,COALESCE(SUM(d.total_transit),0) transit,COALESCE((SELECT SUM(a.inhand_alloc) FROM wms.sap_stk_allocation a WHERE UPPER(TRIM(a.warehouse))=$1 AND UPPER(TRIM(a.sku))=UPPER(TRIM(d.material))),0) inh_alloc,COALESCE((SELECT SUM(a.transit_alloc) FROM wms.sap_stk_allocation a WHERE UPPER(TRIM(a.warehouse))=$1 AND UPPER(TRIM(a.sku))=UPPER(TRIM(d.material))),0) trn_alloc FROM wms.sap_stk_dump d WHERE UPPER(TRIM(d.warehouse))=$1 GROUP BY d.material,d.material_description`,[wh]);
  return rows.map(r=>({sku:norm(r.material),desc:String(r.material_description||'').trim(),sap:n(r.sap),transit:n(r.transit),inhAlloc:n(r.inh_alloc),trnAlloc:n(r.trn_alloc),availInhand:Math.max(0,n(r.sap)-n(r.inh_alloc)),availTotal:Math.max(0,n(r.sap)+n(r.transit)-n(r.inh_alloc)-n(r.trn_alloc))}));
}

async function persistClearOrder({db,warehouse,payload,userId='admin'}){
  if(!payload?.soNumber)return{status:'INVALID_SO'}; const client=await db.connect();
  try{await client.query('BEGIN');const wh=norm(warehouse||'BB04'),so=norm(payload.soNumber);if(!validSo(so))throw new Error('INVALID_SO');if(await existsOrder(client,wh,so))await deleteOrderRows(client,so,true);const stock=await loadStock(client,wh);const plan=buildClearPlan({warehouse:wh,payload,rawStock:stock.raw,allocation:stock.allocation,userId,timestamp:new Date()});if(plan.status!=='DONE')throw new Error(plan.error||plan.status);await writeAllocations(client,plan.allocRows);await client.query(`INSERT INTO wms.clear_order (warehouse,so_number,so_date,party_name_dest_city_name,reference,submit_time,total_lines,lines_json,dump_updated_post_pgi,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[wh,so,plan.soDate||null,plan.party,plan.dest,plan.timestamp,plan.lines.length,plan.linesJson,'',userId]);await writeOrderChecker(client,[so,plan.soDate||null,plan.soldToParty||plan.party,plan.party,plan.dest,plan.linesJson,wh,plan.totalOrderQty,plan.totalTransitQty,plan.remark,plan.shortageRemark]);const updatedStock=await getFreshStock(client,wh);await client.query('COMMIT');return{status:'DONE',allocRows:plan.allocRows.length,updatedStock};}catch(e){try{await client.query('ROLLBACK')}catch(_){}return{status:'ERROR',error:e.message,transaction:'ROLLED_BACK'};}finally{client.release();}
}

async function persistPartialOrder({db,warehouse,payload,userId='admin'}){
  if(!payload?.soNumber)return{status:'INVALID_SO'};const client=await db.connect();
  try{await client.query('BEGIN');const wh=norm(warehouse||'BB04'),so=norm(payload.soNumber);if(!validSo(so))throw new Error('SO Number must be min 6 digits numeric');if(await existsOrder(client,wh,so))await deleteOrderRows(client,so,true);const stock=await loadStock(client,wh);const plan=buildPartialPlan({warehouse:wh,payload,rawStock:stock.raw,allocation:stock.allocation,userId,timestamp:new Date()});if(plan.status!=='DONE')throw new Error(plan.error||plan.status);await writeAllocations(client,plan.allocRows);await client.query(`INSERT INTO wms.partial_clear_orders (warehouse,so_number,so_date,party_name_dest_city_name,reference,submit_time,clear_lines_json,obd,pgi,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[wh,so,plan.soDate||null,plan.party,plan.dest,plan.timestamp,plan.clearJson,plan.obd,plan.pgi,userId]);for(const l of plan.shortLines)await client.query(`INSERT INTO wms.shortage_partial_orders (warehouse,so_number,party_name_dest_city_name,so_date,sku,description,req_qty,avail_inhand,short_bt,status_bt,transit_used,short_at,status_at,submit_time,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[wh,so,plan.party,plan.soDate||null,norm(l.sku),l.desc||'',n(l.reqQty),n(l.availInhand),n(l.shortBT),norm(l.statusBT||''),n(l.trnUsed),n(l.shortAT),norm(l.statusAT||''),plan.timestamp,userId]);await writeOrderChecker(client,[so,plan.soDate||null,plan.soldToParty||plan.party,plan.party,plan.dest,plan.linesJson,wh,plan.totalOrderQty,plan.totalShortBT,plan.finalRemark,'']);const updatedStock=await getFreshStock(client,wh);await client.query('COMMIT');return{status:'DONE',allocRows:plan.allocRows.length,shortRows:plan.shortLines.length,updatedStock};}catch(e){try{await client.query('ROLLBACK')}catch(_){}return{status:'ERROR',error:e.message,transaction:'ROLLED_BACK'};}finally{client.release();}
}

module.exports={norm,n,validSo,validObd,validPgi,buildRunningStock,allocateLines,buildLinesToAllocate,buildPartialPlan,buildClearPlan,loadStock,deleteOrderRows,existsOrder,persistClearOrder,persistPartialOrder};
