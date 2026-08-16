const assert=require('assert');
const a=require('./phase8gProductionAdapter');
const u=a.buildSapDumpUpdate({id:7,batch_qty:'[{"batch":"B1","qty":20}]',total_unrestricted:20,total_transit:0});
assert.strictEqual(u.params[3],7); assert(u.sql.includes('wms.sap_stk_dump')); assert(u.sql.includes('batch_qty=$1'));
const i=a.buildClearOrderInsert({warehouse:'BB04',so_number:'SO1001',so_date:'2026-08-16',party:'P',reference:'DELHI',total_lines:2,lines_json:'[]',updated_by:'u'});
assert.strictEqual(i.params[0],'BB04'); assert.strictEqual(i.params[1],'SO1001'); assert(i.sql.includes('wms.clear_order'));
const d=a.buildClearOrderDelete('bb04',' so1001 '); assert.deepStrictEqual(d.params,['BB04','SO1001']);
const s=a.buildSapDumpSelect('bb04',' sku-a '); assert.deepStrictEqual(s.params,['BB04','SKU-A']);
console.log('Phase 8G production schema adapter contract: PASS');
