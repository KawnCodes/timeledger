import {emptyState, validate, setRate, timer, manual, saveGoal, HOUR, MIN} from './core.mjs';
export function exampleState(wall=Date.now()) {
  const s=emptyState(), anchor=new Date(wall);
  anchor.setHours(14,32,18,0);s.demoOffset=+anchor-wall;
  const t=(h,m=0)=>{const d=new Date(anchor);d.setHours(h,m,0,0);return +d;};
  const items=[
    ['Forma Studio','Brand identity','#7255ac',80,'Design'],
    ['Northline','Website redesign','#348d84',95,'Web'],
    ['Orbit Works','Product strategy','#bd7942',105,'Strategy'],
    ['Field Notes','Editorial design','#5377af',75,'Editorial']
  ];
  items.forEach(([co,name,color,rate,ref],i)=>{
    const c={id:'company-'+i,name:co,color,currency:'GBP',notes:'',billing:''};
    const p={id:'project-'+i,companyId:c.id,name,ref,notes:'',archived:false,favourite:true,order:i,recent:0};
    s.companies.push(c);s.projects.push(p);setRate(s,'company',c.id,rate*100,'GBP',0);
  });
  for(const [i,h,m,eh,em,note] of [[1,8,30,9,30,'Wireframe review'],[2,9,45,10,30,'Discovery workshop'],[0,10,45,12,15,'Identity concepts']]){
    const e=manual(s,'project-'+i,t(h,m),t(eh,em));Object.assign(e,{notes:note,approved:e.end-e.start,billable:true});s.entries.push(e);
  }
  timer(s,'start','project-1',t(12,45));timer(s,'pause','project-1',t(13,19));
  timer(s,'start','project-0',t(13,40),true);
  for(const [p,h,m] of [['day',8,400],['week',40,2000],['month',150,7500],['year',1760,80000]])saveGoal(s,p,+anchor,h,m*100,'defaults');
  return validate(s);
}
export async function openLedger(name, example=false){
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('TimeLedger-'+name,1);
    r.onupgradeneeded=()=>r.result.createObjectStore('ledger');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    r.onblocked=()=>reject(new Error('Close other TimeLedger windows and reopen.'));
  });
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('TimeLedger-'+name):null;
  function transaction(change, notify=true){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('ledger','readwrite'), store=tx.objectStore('ledger'), get=store.get('state');
      let state,error;
      get.onsuccess=()=>{
        try{
          state=get.result??(example?exampleState():emptyState());
          const next=change?.(state);if(next!==undefined)state=next;
          if(change||!get.result)store.put(validate(state),'state');
        }catch(err){error=err;tx.abort();}
      };
      tx.oncomplete=()=>{if(change&&notify)channel?.postMessage('changed');resolve(state);};
      tx.onabort=()=>reject(error??tx.error??new Error('The save was interrupted. Please try again.'));
      tx.onerror=()=>{};
    });
  }
  db.onversionchange=()=>db.close();
  return {read:()=>transaction(null),write:transaction,subscribe:fn=>{if(channel)channel.onmessage=fn;}};
}
