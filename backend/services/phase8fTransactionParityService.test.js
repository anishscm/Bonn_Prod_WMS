const assert = require('assert');
const { runAtomicStoredOrderFlow } = require('./phase8fTransactionParityService');

function fakeDb() {
  const calls=[];
  const client={
    query: async sql => { calls.push(sql); if(sql==='FAIL') throw new Error('forced failure'); return {rows:[],rowCount:1}; },
    release:()=>{}
  };
  return {calls,connect:async()=>client};
}
(async()=>{
  const okDb=fakeDb();
  const ok=await runAtomicStoredOrderFlow(okDb,{},async c=>{await c.query('WRITE_ORDER');await c.query('WRITE_DUMP');});
  assert.deepStrictEqual(ok,{status:'DONE',transaction:'COMMITTED'});
  assert.deepStrictEqual(okDb.calls,['BEGIN','WRITE_ORDER','WRITE_DUMP','COMMIT']);

  const badDb=fakeDb();
  const bad=await runAtomicStoredOrderFlow(badDb,{},async c=>{await c.query('WRITE_ORDER');await c.query('FAIL');});
  assert.strictEqual(bad.status,'ERROR');
  assert.strictEqual(bad.transaction,'ROLLED_BACK');
  assert.deepStrictEqual(badDb.calls,['BEGIN','WRITE_ORDER','FAIL','ROLLBACK']);
  console.log('Phase 8F atomic transaction parity: PASS');
})();
