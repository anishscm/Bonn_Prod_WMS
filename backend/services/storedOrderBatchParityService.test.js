const assert=require('assert');
const {allocateStoredOrder,allocateStoredOrders,parseBatches}=require('./storedOrderBatchParityService');

const dump=[
 {warehouse:'BB04',sloc:'FG01',material:'A',desc:'A',batches:[{batch:'B1',qty:30},{batch:'B2',qty:50}],totalUnrestricted:80,totalTransit:0},
 {warehouse:'BB04',sloc:'FG02',material:'A',desc:'A',batches:[{batch:'B3',qty:40}],totalUnrestricted:40,totalTransit:0},
 {warehouse:'BB04',sloc:'FG01',material:'B',desc:'B',batches:[{batch:'C1',qty:10}],totalUnrestricted:10,totalTransit:0}
];

{
 const r=allocateStoredOrder({soNumber:'123456',lines:[{sku:'A',qty:60}],remark:'',pgi:'9876543210'},dump.map(x=>JSON.parse(JSON.stringify(x))),'BB04',false,'',new Date().toISOString());
 assert.strictEqual(r.status,'DONE');
 assert.deepStrictEqual(r.clearLines,[{sku:'A',qty:60,desc:''}]);
 assert.strictEqual(r.batchAllocations[0],'A[B1(30),B2(30)]');
 assert.strictEqual(r.remark,'FULL ALLOCATION - BATCH: A[B1(30),B2(30)]');
 assert.strictEqual(r.pgi,'9876543210');
 assert.strictEqual(r.dumpUpdates.length,1);
 assert.strictEqual(r.dumpUpdates[0].totalUnrestricted,20);
}

{
 const local=dump.map(x=>JSON.parse(JSON.stringify(x)));
 const r=allocateStoredOrder({soNumber:'123457',lines:[{sku:'A',qty:100}],remark:''},local,'BB04',true,'1111111111','ts');
 assert.strictEqual(r.status,'DONE');
 assert.strictEqual(r.remark,'FULL ALLOCATION - BATCH');
 assert.strictEqual(r.batchAllocations.join(';'),'A[B1(30),B2(50),B3(20)]');
}

{
 const local=dump.map(x=>JSON.parse(JSON.stringify(x)));
 const r=allocateStoredOrder({soNumber:'123458',lines:[{sku:'A',qty:150}],remark:''},local,'BB04',false,'','ts');
 assert.strictEqual(r.status,'PARTIAL');
 assert.strictEqual(r.clearLines[0].qty,120);
 assert.strictEqual(r.shortLines[0].shortBT,30);
 assert.strictEqual(r.shortLines[0].statusBT,'PARTIAL');
 assert.strictEqual(r.shortLines[0].statusAT,'SHORT');
}

{
 const local=dump.map(x=>JSON.parse(JSON.stringify(x)));
 const r=allocateStoredOrder({soNumber:'123459',lines:[{sku:'A',qty:1}],remark:'FULL ALLOCATION - BATCH'},local,'BB04',false,'','ts');
 assert.strictEqual(r.status,'ALREADY_ALLOCATED');
}

{
 const local=dump.map(x=>JSON.parse(JSON.stringify(x)));
 const r=allocateStoredOrders({warehouse:'BB04',orders:[
  {soNumber:'200001',lines:[{sku:'A',qty:70}],remark:''},
  {soNumber:'200002',lines:[{sku:'A',qty:50}],remark:''}
 ],dumpRows:local,isManualAllocation:false,globalPgi:'1234567890',timestamp:'ts'});
 assert.strictEqual(r.results['200001'].batchAllocations[0],'A[B1(30),B2(40)]');
 assert.strictEqual(r.results['200002'].batchAllocations[0],'A[B2(10),B3(40)]');
 assert.strictEqual(r.finalDumpRows.length,1);
 assert.strictEqual(r.finalDumpRows[0][2],'B');
 assert.strictEqual(r.finalDumpRows[0][5],10);
}

assert.deepStrictEqual(parseBatches('[{"batch":"X","qty":2}]'),[{batch:'X',qty:2}]);
console.log('Phase 8D stored-order FIFO batch parity tests: PASS');
