/** Phase 6C deterministic inventory transaction model. */
function clone(x){ return JSON.parse(JSON.stringify(x)); }
function deduct(state, req) {
  const next = clone(state);
  const key = `${req.warehouse}|${req.bin}|${req.sku}|${req.mfg}`;
  const row = next.stock[key];
  if (!row) throw new Error("STOCK_NOT_FOUND");
  if (row.qty < req.qty) throw new Error("INSUFFICIENT_STOCK");
  row.qty -= req.qty;
  const allocKey = `${req.warehouse}|${req.so}|${req.sku}`;
  if (next.alloc[allocKey]) next.alloc[allocKey].qty = Math.max(0, next.alloc[allocKey].qty - req.qty);
  next.binTx.push({warehouse:req.warehouse,bin:req.bin,sku:req.sku,mfg:req.mfg,qty:req.qty,type:"OUTBOUND",so:req.so});
  next.outward.push({so:req.so,sku:req.sku,qty:req.qty,bin:req.bin,mfg:req.mfg});
  next.operation.push({so:req.so,sku:req.sku,qty:req.qty,bin:req.bin,mfg:req.mfg});
  return next;
}
module.exports = { deduct };
