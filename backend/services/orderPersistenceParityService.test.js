const assert = require('assert');
const {
  buildRunningStock, allocateLines, buildLinesToAllocate,
  buildPartialPlan, buildClearPlan, deleteOrderRows
} = require('./orderPersistenceParityService');

const raw={A:{sap:100,transit:40,desc:'A'},B:{sap:20,transit:5,desc:'B'},C:{sap:0,transit:0,desc:'C'}};

{
  const r=buildRunningStock(raw,{inhand:{A:10},transit:{A:5}});
  assert.deepStrictEqual(r.runInh,{A:90,B:20,C:0});
  assert.deepStrictEqual(r.runTrn,{A:35,B:5,C:0});
}

{
  const r=buildRunningStock(raw,{inhand:{},transit:{}});
  const rows=allocateLines([{sku:'A',qty:80},{sku:'A',qty:50},{sku:'B',qty:30}],raw,r.runInh,r.runTrn,'BB04','123456','2026-08-16','P','C',new Date(),'u');
  assert.strictEqual(rows[0].inhandAlloc,80);
  assert.strictEqual(rows[1].inhandAlloc,20); assert.strictEqual(rows[1].transitAlloc,30);
  assert.strictEqual(rows[2].inhandAlloc,20); assert.strictEqual(rows[2].transitAlloc,5);
}

{
  const lines=buildLinesToAllocate({lines:[{sku:'A',qty:100},{sku:'B',qty:30}],clearLines:[{sku:'A',qty:100,desc:'A'}],shortLines:[{sku:'B',reqQty:30,availInhand:20,trnUsed:5,desc:'B'}]});
  assert.deepStrictEqual(lines,[{sku:'A',qty:100,desc:'A'},{sku:'B',qty:25,desc:'B'}]);
}

{
  const p=buildPartialPlan({warehouse:'BB04',payload:{soNumber:'123456',soDate:'2026-08-16',partyName:'P',destCity:'C',soldToParty:'S',lines:[{sku:'A',qty:100},{sku:'B',qty:30}],clearLines:[{sku:'A',qty:100}],shortLines:[{sku:'B',reqQty:30,availInhand:20,shortBT:10,statusBT:'SHORT',trnUsed:5,shortAT:5,statusAT:'SHORT'}]},rawStock:raw,allocation:{inhand:{},transit:{}},userId:'u',timestamp:new Date()});
  assert.strictEqual(p.totalOrderQty,130); assert.strictEqual(p.totalShortBT,10); assert.strictEqual(p.finalRemark,'Partial Allocation'); assert.strictEqual(p.allocRows.length,2);
}

{
  const p=buildClearPlan({warehouse:'BB04',payload:{soNumber:'123456',lines:[{sku:'A',qty:130}],partyName:'P',destCity:'C'},rawStock:raw,allocation:{inhand:{},transit:{}},userId:'u',timestamp:new Date()});
  assert.strictEqual(p.totalTransitQty,30); assert.strictEqual(p.remark,'Full Allocation (Transit)'); assert.strictEqual(p.shortageRemark,'A(30)');
}

(async()=>{
  const seen=[]; const client={query:async sql=>{seen.push(sql);return {rows:[],rowCount:0};}};
  await deleteOrderRows(client,'123456',true);
  assert.strictEqual(seen.length,5);
  ['partial_clear_orders','shortage_partial_orders','sap_stk_allocation','clear_order','order_checker'].forEach(t=>assert(seen.some(s=>s.includes(t))));
  console.log('Phase 8C order persistence parity tests: PASS');
})();
