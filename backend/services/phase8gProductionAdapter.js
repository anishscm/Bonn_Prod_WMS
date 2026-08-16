/** Phase 8G production-shaped adapter contract. Read/write SQL builders only; not invoked by production. */
function norm(v){return String(v??'').replace(/\s+/g,' ').trim().toUpperCase();}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function buildSapDumpUpdate(row){
  if(!row || row.id==null) throw new Error('SAP_STK_DUMP row id required');
  return {sql:`UPDATE wms.sap_stk_dump SET batch_qty=$1,total_unrestricted=$2,total_transit=$3,updated_at=now() WHERE id=$4`,params:[String(row.batch_qty??''),num(row.total_unrestricted),num(row.total_transit),row.id]};
}
function buildClearOrderInsert(order){
  return {sql:`INSERT INTO wms.clear_order (warehouse,so_number,so_date,party_name_dest_city_name,reference,submit_time,total_lines,lines_json,dump_updated_post_pgi,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,params:[norm(order.warehouse),norm(order.so_number),order.so_date||null,order.party||'',order.reference||'',order.submit_time||new Date(),num(order.total_lines),String(order.lines_json||'[]'),String(order.dump_updated_post_pgi||''),order.updated_by||'admin']};
}
function buildClearOrderDelete(warehouse,so){return {sql:`DELETE FROM wms.clear_order WHERE UPPER(TRIM(warehouse))=$1 AND UPPER(TRIM(so_number))=$2`,params:[norm(warehouse),norm(so)]};}
function buildSapDumpSelect(warehouse,material){return {sql:`SELECT id,warehouse,s_loc,material,material_description,batch_qty,total_unrestricted,total_transit FROM wms.sap_stk_dump WHERE UPPER(TRIM(warehouse))=$1 AND UPPER(TRIM(material))=$2 ORDER BY id`,params:[norm(warehouse),norm(material)]};}
module.exports={norm,num,buildSapDumpUpdate,buildClearOrderInsert,buildClearOrderDelete,buildSapDumpSelect};
