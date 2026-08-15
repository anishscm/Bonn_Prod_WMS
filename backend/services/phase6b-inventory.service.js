const { transaction } = require("../db");
const { norm } = require("../utils/normalize");

function cleanMfg(v){ return norm(v).replace(/[^0-9]/g,""); }

async function saveOrUpdateStock(client,data){
  const month=norm(data.month), bin=norm(data.bin), sku=norm(data.sku);
  const plant=norm(data.plant||"BB04"), qty=Number(data.qty)||0;
  if(!sku||qty<=0) return {status:"INVALID"};
  const q=await client.query(
    `SELECT id,qty,product_name FROM wms.phy_stk_entry
      WHERE UPPER(TRIM(COALESCE(mfg_month,'')))=$1
        AND UPPER(TRIM(COALESCE(bin,'')))=$2
        AND UPPER(TRIM(COALESCE(sku,'')))=$3
        AND UPPER(TRIM(COALESCE(plant,'')))=$4
      ORDER BY id FOR UPDATE`,[month,bin,sku,plant]);
  if(q.rows.length){
    const row=q.rows[0], newQty=Number(row.qty||0)+qty;
    await client.query(`UPDATE wms.phy_stk_entry SET qty=$1,
      product_name=CASE WHEN COALESCE(product_name,'')='' THEN $2 ELSE product_name END,
      updated_at=now() WHERE id=$3`,[newQty,data.name||"",row.id]);
    return {status:"UPDATED",newQty,month,bin,sku};
  }
  const ins=await client.query(`INSERT INTO wms.phy_stk_entry
    (mfg_month,bin,sku,product_name,qty,computation_logic,plant,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [month,bin,sku,data.name||"",qty,"STOCK_ENTRY_COMPAT",plant,"ACTIVE"]);
  return {status:"SAVED",newQty:qty,month,bin,sku,id:ins.rows[0].id};
}

async function confirmOutboundPhysicalDeduction(payload){
  const items=Array.isArray(payload?.items)?payload.items:[];
  if(!items.length) return {status:"ERROR",message:"No allocated rows provided."};
  const warehouse=norm(payload.warehouse||"BB04");
  const targets=new Set();
  for(const s of [].concat(payload.soNumber||[],payload.obdNumber||[],payload.soList||[]))
    String(s).split(",").forEach(v=>{const n=norm(v);if(n)targets.add(n);});

  return transaction(async client=>{
    const logs=[]; let deletedAlloc=0, deletedPhy=0;
    for(const item of items){
      const sku=norm(item.sku),bin=norm(item.bin);
      const requested=Number(item.allocatedQty||item.allocQty)||0;
      if(!sku||!bin||requested<=0) continue;
      const mfg=cleanMfg(item.mfgMonth||item.mfg||"");
      let q=await client.query(
        `SELECT id,mfg_month,bin,sku,qty,plant FROM wms.phy_stk_entry
         WHERE UPPER(TRIM(COALESCE(sku,'')))=$1
           AND UPPER(TRIM(COALESCE(bin,'')))=$2
           AND (COALESCE(plant,'')='' OR UPPER(TRIM(plant))=$3 OR $3='ALL'
             OR (UPPER(TRIM(plant)) IN ('BB04','1002') AND $3 IN ('BB04','1002'))
             OR (UPPER(TRIM(plant)) IN ('BB02','1001') AND $3 IN ('BB02','1001')))
           AND ($4='' OR regexp_replace(UPPER(COALESCE(mfg_month,'')),'[^0-9]','','g')=$4
             OR UPPER(COALESCE(mfg_month,''))='NA' OR $4='NA')
         ORDER BY id FOR UPDATE`,[sku,bin,warehouse,mfg]);
      if(!q.rows.length){
        q=await client.query(
          `SELECT id,mfg_month,bin,sku,qty,plant FROM wms.phy_stk_entry
           WHERE UPPER(TRIM(COALESCE(sku,'')))=$1 AND UPPER(TRIM(COALESCE(bin,'')))=$2
             AND (COALESCE(plant,'')='' OR UPPER(TRIM(plant))=$3 OR $3='ALL')
           ORDER BY id FOR UPDATE`,[sku,bin,warehouse]);
      }
      if(!q.rows.length) throw new Error(`Physical stock not found for ${sku}/${bin}.`);
      const row=q.rows[0], current=Number(row.qty)||0;
      if(current<requested) throw new Error(`Insufficient physical stock for ${sku}/${bin}: available ${current}, requested ${requested}.`);
      const newQty=current-requested;
      if(newQty<=0){await client.query(`DELETE FROM wms.phy_stk_entry WHERE id=$1`,[row.id]);deletedPhy++;}
      else await client.query(`UPDATE wms.phy_stk_entry SET qty=$1,updated_at=now() WHERE id=$2`,[newQty,row.id]);
      logs.push([warehouse,new Date(),item.bin,item.sku,requested,item.mfgMonth||"",
        "OUTBOUND DEDUCT",item.soNumber||payload.soNumber||payload.obdNumber||"BATCH_CONFIRM",payload.updatedBy||"admin"]);
    }
    if(targets.size){
      const r=await client.query(
        `DELETE FROM wms.phy_stk_allocation
         WHERE UPPER(TRIM(REPLACE(COALESCE(so_number,''), chr(39), ''))) = ANY($1)`,
        [[...targets]]);
      deletedAlloc=r.rowCount;
    }
    for(const x of logs)
      await client.query(`INSERT INTO wms.bin_txin
       (warehouse,event_timestamp,bin,sku,qty,batch,transaction_type,doc_number,user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,x);
    return {status:"SUCCESS",deductedLines:logs.length,allocationRowsDeleted:deletedAlloc,physicalRowsDeleted:deletedPhy};
  });
}

module.exports={saveOrUpdateStock,confirmOutboundPhysicalDeduction};
