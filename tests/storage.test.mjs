import test from 'node:test';
import assert from 'node:assert/strict';
import {openLedger,exampleState} from '../docs/storage.mjs';
import {timer,focus,active,focused,entryStats,validate,encodeBackup,decodeBackup,recordAdjustment,MIN,HOUR} from '../docs/core.mjs';

// Small deterministic IDB adapter. The companion browser suite uses real IndexedDB.
function memoryIDB() {
  const databases=new Map();
  return {open(name) {
    const fresh=!databases.has(name);
    if(fresh)databases.set(name,{value:undefined,tail:Promise.resolve()});
    const memory=databases.get(name), request={};
    request.result={
      createObjectStore(){},
      transaction() {
        let next,aborted=false;
        const tx={abort(){aborted=true;},objectStore(){return {
          put(value){next=structuredClone(value);},
          get(){
            const r={};
            memory.tail=memory.tail.then(()=>{
              r.result=structuredClone(memory.value);
              r.onsuccess();
              if(aborted)tx.onabort();
              else{if(next!==undefined)memory.value=next;tx.oncomplete();}
            });
            return r;
          }
        };}};
        return tx;
      }
    };
    queueMicrotask(()=>{if(fresh)request.onupgradeneeded();request.onsuccess();});
    return request;
  }};
}
test('atomic persistence, concurrent updates, restart, and failed-write rollback',async()=>{
  Object.defineProperty(globalThis,'indexedDB',{value:memoryIDB(),configurable:true});
  const channel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  try{
    const db=await openLedger('test');
    await db.write(()=>exampleState(Date.parse('2026-01-12T12:30:00Z')));
    let saved=await db.read(), stamp=Math.max(...saved.entries.map(e=>e.start))+HOUR;
    const other=await openLedger('test');
    await Promise.all([db.write(s=>{timer(s,'start','project-2',stamp);}),other.write(s=>{timer(s,'start','project-3',stamp);})]);
    saved=await db.read();
    assert.ok(active(saved,'project-2')&&active(saved,'project-3'));
    await other.write(s=>{focus(s,'project-2',stamp+MIN);});
    const restarted=await openLedger('test');
    saved=await restarted.read();
    assert.ok(focused(active(saved,'project-2')));
    assert.equal(entryStats(active(saved,'project-2'),[0,Infinity],stamp+HOUR).logged,HOUR);
    await assert.rejects(db.write(s=>{s.entries=[];throw Error('interrupted');}),/interrupted/);
    assert.deepEqual(await db.read(),saved);
    await assert.rejects(db.write(s=>{s.entries.push(s.entries[0]);}),/duplicate/);
    assert.deepEqual(await db.read(),saved);
  }finally{globalThis.BroadcastChannel=channel;delete globalThis.indexedDB;}
});
test('confirmed payment, adjustments and reporting batches survive a full backup',()=>{
  const at=Date.parse('2026-01-12T12:30:00Z'),s=exampleState(at),e=s.entries[0];
  recordAdjustment(s,e.id,e.approved,0,at);e.approved=0;e.status='Paid';
  s.payments.push({id:'receipt',entryId:e.id,currency:e.currency,amount:4500,at});
  s.batches.push({id:'batch',at,type:'Print',range:[at,at+HOUR],entryIds:[e.id]});
  const recovered=decodeBackup(encodeBackup(s));assert.deepEqual(recovered,s);
  recovered.payments.push({...recovered.payments[0],id:'another'});
  assert.throws(()=>validate(recovered),/payment/);
});
