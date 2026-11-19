// Pure timekeeping and reporting. Durations are milliseconds, money is integer minor units.
export const HOUR = 3600000, MIN = 60000;
export const periods = ['day', 'week', 'month', 'year'];
export const statuses = ['Unreported', 'Submitted', 'Invoiced', 'Paid'];
export const currencies = ['GBP','EUR','USD','CAD','AUD','CHF','NZD'];
export const uid = () => crypto.randomUUID();
// Approximate fallback exchange rates (units per 1 EUR). Replaced by published ECB rates when online.
export const defaultFx = () => ({rates:{EUR:1,GBP:0.86,USD:1.16,CAD:1.62,AUD:1.78,CHF:0.93,NZD:2.02},at:null,source:'built-in'});
export function convert(minor, from, to, fx) {
  if (from === to || !minor) return minor;
  const a = fx?.rates?.[from], b = fx?.rates?.[to];
  requireThat(a > 0 && b > 0, 'Missing exchange rate for '+from+' or '+to+'.');
  return Math.round(minor * b / a);
}
// Sum a {currency: minor} map in one currency at the stored exchange rates.
export function totalIn(amounts, to, fx) {
  return Object.entries(amounts).reduce((n,[cc,v])=>n+convert(v,cc,to,fx),0);
}
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export const keyDate = ms => {
  const d = new Date(ms);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
};
export function localDate(key) {
  requireThat(/^\d{4}-\d\d-\d\d$/.test(key), 'Choose a valid date.');
  const d = new Date(key + 'T00:00:00');
  requireThat(keyDate(d) === key, 'Choose a valid calendar date.');
  return d;
}
export function periodRange(period, at, weekStart = 1) {
  const d = localDate(keyDate(at));
  if (period === 'week') d.setDate(d.getDate() - (d.getDay()-weekStart+7)%7);
  if (period === 'month') d.setDate(1);
  if (period === 'year') d.setMonth(0,1);
  const end = new Date(d);
  if (period === 'year') end.setFullYear(end.getFullYear()+1);
  else if (period === 'month') end.setMonth(end.getMonth()+1);
  else end.setDate(end.getDate() + (period === 'week' ? 7 : 1));
  return [+d,+end];
}
export function clockValue(date, clock, later = false) {
  localDate(date);
  requireThat(/^\d\d:\d\d(:\d\d(\.\d{1,3})?)?$/.test(clock), 'Enter a valid time.');
  const d = new Date(date+'T'+clock);
  const canonical = keyDate(d)+'T'+[d.getHours(),d.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');
  requireThat(canonical === date+'T'+clock.slice(0,5), 'This local time does not exist. Check the daylight-saving transition.');
  if (later) {
    const next = new Date(d); next.setDate(d.getDate()+1);
    const delta = (next.getTimezoneOffset()-d.getTimezoneOffset())*MIN;
    const second = new Date(+d+delta);
    if (delta > 0 && second.getHours() === d.getHours() && second.getMinutes() === d.getMinutes()) return +second;
  }
  return +d;
}
export function emptyState() {
  return {schema:1, companies:[], projects:[], entries:[], rates:[], defaults:[], overrides:[],
    batches:[], payments:[], adjustments:[], audit:[], targets:[], settings:{sound:true, streak:'worked', restWeekends:true, basis:'unique', currency:'GBP', weekStart:1,
      theme:'system', period:'day', collapsed:false, rounding:1, backupAt:null, fx:defaultFx()}};
}
export const byId = (rows, id) => rows.find(r=>r.id===id);
export const active = (s, p) => s.entries.find(e=>e.projectId===p && e.end===null);
export const conditionOf = e => !e || e.end!==null ? 'Ready' : e.segments.at(-1)?.[1]===null ? 'Running' : 'Paused';
export const focused = e => e?.focus.at(-1)?.[1]===null;
export function favourites(s) { return s.projects.filter(p=>p.favourite&&!p.archived).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name)); }
export function moveFavourite(s,id,dir) {
  const list=favourites(s), i=list.findIndex(p=>p.id===id), j=i+dir;
  if(i<0||j<0||j>=list.length)return;
  [list[i],list[j]]=[list[j],list[i]];list.forEach((p,k)=>p.order=k);
}
// Delete projects with everything recorded against them. Running timers must be stopped first.
export function deleteProjects(s, ids) {
  ids = new Set(ids);
  requireThat(!s.entries.some(e => ids.has(e.projectId) && e.end === null), 'Stop the running timer first.');
  const gone = new Set(s.entries.filter(e => ids.has(e.projectId)).map(e => e.id));
  s.entries = s.entries.filter(e => !gone.has(e.id));
  s.payments = s.payments.filter(p => !gone.has(p.entryId));
  s.adjustments = s.adjustments.filter(a => !gone.has(a.entryId));
  s.rates = s.rates.filter(r => !(r.kind === 'project' && ids.has(r.owner)));
  s.targets = s.targets.filter(t => !(t.kind === 'project' && ids.has(t.owner)));
  s.projects = s.projects.filter(p => !ids.has(p.id));
  return gone.size;
}
export function deleteCompany(s, id) {
  const entries = deleteProjects(s, s.projects.filter(p => p.companyId === id).map(p => p.id));
  s.rates = s.rates.filter(r => !(r.kind === 'company' && r.owner === id));
  s.targets = s.targets.filter(t => !(t.kind === 'company' && t.owner === id));
  s.companies = s.companies.filter(c => c.id !== id);
  return entries;
}
export function audit(s,action,at,entity='') { s.audit.push({id:uid(),action,at,entity}); }
export function setRate(s, kind, owner, amount, currency, at) {
  requireThat(amount===null || (Number.isSafeInteger(amount)&&amount>=0&&amount<=1e10),'Enter a valid hourly rate.');
  s.rates.push({id:uid(),kind,owner,amount,currency,at});
}
export function rateAt(s,p,at) {
  const lookup = (kind,owner) => s.rates.filter(r=>r.kind===kind && r.owner===owner && r.at<=at).sort((a,b)=>b.at-a.at||s.rates.indexOf(b)-s.rates.indexOf(a))[0];
  const company = byId(s.companies,p.companyId);
  const base=lookup('company',company.id), override=lookup('project',p.id), cc=projectCurrency(s,p);
  if(override&&override.amount!==null)return {rate:override.amount,currency:override.currency};
  // No project rate: use the company rate, converted when the project bills in another currency.
  const bc=base?.currency??company.currency;
  return {rate:base?.amount==null?null:convert(base.amount,bc,cc,s.settings.fx),currency:cc};
}
// A project bills in its own currency when set, otherwise in its company's.
export const projectCurrency=(s,p)=>p.currency??byId(s.companies,p.companyId).currency;
function baseEntry(s,projectId,at,kind,allowArchived=false) {
  const p=byId(s.projects,projectId);
  requireThat(p&&(allowArchived||!p.archived),'Select an active project.');
  return {id:uid(),kind,projectId,companyId:p.companyId,start:at,end:null,segments:[],pauses:[],focus:[],
    ...rateAt(s,p,at),billable:false,approved:null,status:'Unreported',notes:'',reference:'',revision:0};
}
function closeOpen(list,at) { if(list.at(-1)?.[1]===null)list.at(-1)[1]=at; }
function latest(e) {return Math.max(e.start,...[e.segments,e.pauses,e.focus].flat(2).filter(Number.isFinite));}
export function focus(s, projectId, at) {
  const next=projectId?active(s,projectId):null;
  if(projectId)requireThat(conditionOf(next)==='Running','Only a running timer can receive focus.');
  const previous=s.entries.find(focused);
  if(previous===next || (!previous&&!next))return;
  for(const e of [previous,next].filter(Boolean))requireThat(at>=latest(e),'The device clock moved backwards. Check the time before continuing.');
  if(previous){closeOpen(previous.focus,at);previous.revision++;}
  if(next){next.focus.push([at,null]);next.revision++;byId(s.projects,next.projectId).recent=at;}
}
export function timer(s, action, projectId, at, withFocus=false) {
  let e=active(s,projectId);
  if(action==='start'){
    requireThat(!e,'This project already has an active session.');
    e=baseEntry(s,projectId,at,'timer');e.segments.push([at,null]);s.entries.push(e);
  } else {
    requireThat(e,'This session has already stopped.');
    requireThat(at>=latest(e),'The device clock moved backwards. Check its date and time.');
    if(action==='resume'){
      requireThat(conditionOf(e)==='Paused','This timer is already running.');
      closeOpen(e.pauses,at);e.segments.push([at,null]);
    } else {
      requireThat(action==='stop'||(action==='pause'&&conditionOf(e)==='Running'),'This timer cannot perform that action.');
      if(focused(e))focus(s,null,at);
      closeOpen(e.segments,at);closeOpen(e.pauses,at);
      if(action==='pause')e.pauses.push([at,null]);else e.end=at;
    }
  }
  byId(s.projects,projectId).recent=at;e.revision++;
  if(withFocus)focus(s,projectId,at);
  return e;
}
export function manual(s,projectId,start,end,breakMs=0,breakStart=end-breakMs,allowArchived=false) {
  requireThat(isTime(start)&&isTime(end)&&end>start,'Finish must be after start.');
  requireThat(Number.isSafeInteger(breakMs)&&breakMs>=0&&breakMs<end-start,'Break must be shorter than the session.');
  requireThat(!breakMs||(breakStart>=start&&breakStart+breakMs<=end),'The break must fit inside this entry.');
  const e=baseEntry(s,projectId,start,'manual',allowArchived);e.end=end;
  e.pauses=breakMs?[[breakStart,breakStart+breakMs]]:[];
  e.segments=breakMs?[[start,breakStart],[breakStart+breakMs,end]].filter(([a,b])=>b>a):[[start,end]];
  return e;
}
export function clip(intervals,range,now) {
  return intervals.map(([a,b])=>[Math.max(a,range[0]),Math.min(b??now,range[1])]).filter(([a,b])=>b>a);
}
export const lengthOf = intervals => intervals.reduce((n,[a,b])=>n+b-a,0);
export function union(intervals) {
  const result=[];
  for(const [a,b] of [...intervals].sort((x,y)=>x[0]-y[0])){
    const last=result.at(-1);
    if(last&&a<=last[1])last[1]=Math.max(last[1],b);else result.push([a,b]);
  }
  return result;
}
const all=[-Infinity,Infinity];
export function overlaps(s,range,now) {
  const spans=s.entries.flatMap(e=>clip(e.segments,range,now).map(([a,b])=>({a,b,id:e.id}))).sort((x,y)=>x.a-y.a);
  const hits=new Set();let live=[];
  for(const v of spans){live=live.filter(x=>x.b>v.a);for(const x of live)if(x.id!==v.id){hits.add(x.id);hits.add(v.id);}live.push(v);}
  return hits;
}
// Cumulative allocation keeps neighbouring date ranges additive down to the penny.
function portion(total,n,d) { if(!d)return 0;return Number((2n*BigInt(total)*BigInt(n)+BigInt(d))/(2n*BigInt(d))); }
export function entryStats(e,range,now) {
  const seg=clip(e.segments,range,now), logged=lengthOf(seg), whole=lengthOf(clip(e.segments,all,now));
  const before=lengthOf(clip(e.segments,[-Infinity,range[0]],now));
  const allocation=total=>portion(total,before+logged,whole)-portion(total,before,whole);
  const approved=e.approved===null?null:allocation(e.approved);
  const incomplete=!!(e.billable&&e.approved>0&&e.rate===null&&logged);
  const amount=e.billable&&e.approved!==null&&e.rate!==null?allocation(portion(e.rate,e.approved,HOUR)):0;
  return {seg,logged,focus:lengthOf(clip(e.focus,range,now)),breakMs:lengthOf(clip(e.pauses,range,now)),approved,amount,incomplete};
}
export function summary(entries,range,now) {
  const out={logged:0,unique:0,overlap:0,focus:0,approved:0,money:{},invoiced:{},invoicedIncomplete:new Set(),incomplete:new Set()};
  const seg=[];
  for(const e of entries){
    const a=entryStats(e,range,now);seg.push(...a.seg);
    out.logged+=a.logged;out.approved+=a.approved??0;out.focus+=a.focus;
    if(a.logged&&e.billable&&e.approved!==null){
      out.money[e.currency]=(out.money[e.currency]??0)+a.amount;
      if(['Invoiced','Paid'].includes(e.status))out.invoiced[e.currency]=(out.invoiced[e.currency]??0)+a.amount;
    }
    if(a.incomplete){
      out.incomplete.add(e.currency);
      if(['Invoiced','Paid'].includes(e.status))out.invoicedIncomplete.add(e.currency);
    }
  }
  out.unique=lengthOf(union(seg));out.overlap=out.logged-out.unique;return out;
}
// Goals survive a change of goal currency: a target saved in another currency is converted.
export function goal(s,period,at) {
  const key=keyDate(periodRange(period,at,s.settings.weekStart)[0]), cc=s.settings.currency;
  const pick=list=>list.find(g=>g.currency===cc)??list[0];
  const mine=s.overrides.filter(g=>g.period===period&&g.key===key);
  let g=mine.length?pick(mine):null;
  if(!g){
    const older=s.defaults.filter(g=>g.period===period&&g.key<=key).sort((a,b)=>b.key.localeCompare(a.key));
    g=older.length?pick(older.filter(x=>x.key===older[0].key)):null;
  }
  if(!g)return {hours:null,money:null};
  return g.currency===cc||g.money===null?g:{...g,money:convert(g.money,g.currency,cc,s.settings.fx),currency:cc,sourceCurrency:g.currency};
}
export function saveGoal(s,period,at,hours,money,scope) {
  requireThat(periods.includes(period)&&['overrides','defaults'].includes(scope),'Invalid goal period.');
  const key=keyDate(periodRange(period,at,s.settings.weekStart)[0]), currency=s.settings.currency;
  const same=s[scope].filter(g=>g.period===period&&g.key===key), g=same.find(g=>g.currency===currency)??same[0];
  s[scope]=s[scope].filter(x=>x===g||!same.includes(x));
  const next={id:g?.id??uid(),period,key,currency,hours,money};
  if(g)Object.assign(g,next);else s[scope].push(next);
}
export function progress(actual,target) {
  if(!target)return null;const percent=Math.round(100*actual/target);
  return {percent,bar:Math.min(100,100*actual/target),remaining:Math.max(0,target-actual)};
}
export function recordAdjustment(state, entryId, previous, approved, at) {
  if (previous === approved) return;
  state.adjustments.push({id: uid(), entryId, previous, approved, at});
}
export function roundForReview(ms,minutes) {return Math.round(ms/(minutes*MIN))*minutes*MIN;}
export function csvCell(value) {
  let t=String(value??'');if(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(t))t="'"+t;
  return '"'+t.replaceAll('"','""')+'"';
}
export function csv(s,entries,range,now) {
  const iso=ms=>new Date(ms).toISOString();
  const local=ms=>new Date(ms).toLocaleString('en-GB',{hour12:false,timeZoneName:'short'});
  const hours=ms=>ms===null?'':(ms/HOUR).toFixed(6);
  const rows=[['Entry ID','Company','Project','Date','Start','Finish','Break minutes','Logged hours','Focus hours','Reportable hours','Currency','Hourly rate','Estimated earnings','Billable','Reporting status','Notes','Timesheet/invoice reference','Window start (UTC)','Window end exclusive (UTC)','Overlap','Session start (UTC)','Session finish (UTC)']];
  const hits=overlaps(s,range,now);
  for(const e of entries){
    const a=entryStats(e,range,now), start=Math.max(e.start,range[0]), end=Math.min(e.end??now,range[1]);
    rows.push([e.id,byId(s.companies,e.companyId).name,byId(s.projects,e.projectId).name,
      new Date(start).toLocaleDateString('en-GB'),local(start),local(end),a.breakMs/MIN,hours(a.logged),e.focus.length?hours(a.focus):'',hours(a.approved),e.currency,
      e.rate===null?'':(e.rate/100).toFixed(2),a.incomplete||a.approved===null?'':(a.amount/100).toFixed(2),e.billable?'Yes':'No',e.status,e.notes,e.reference,iso(range[0]),iso(range[1]),hits.has(e.id)?'Yes':'No',iso(e.start),e.end===null?'':iso(e.end)]);
  }
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
const isTime=n=>Number.isSafeInteger(n)&&n>=0&&n<=8640000000000000;
const minor=n=>n===null||(Number.isSafeInteger(n)&&n>=0&&n<=1e10);
const isId=x=>typeof x==='string'&&/^[\w-]{1,100}$/.test(x);
const textField=x=>typeof x==='string'&&x.length<=100000;
export function validate(s) {
  const check=(v,m)=>requireThat(v,'Invalid backup or record. '+m);
  check(s&&s.schema===1,'Unsupported schema.');
  if (s.adjustments === undefined) s.adjustments = [];
  if (s.targets === undefined) s.targets = [];
  if (s.settings) for (const [k, v] of Object.entries({sound: true, streak: 'worked', restWeekends: true})) if (s.settings[k] === undefined) s.settings[k] = v;
  check(s.demoOffset === undefined || (Number.isSafeInteger(s.demoOffset) && Math.abs(s.demoOffset) <= 26 * HOUR), 'Invalid example clock.');
  const names=['companies','projects','entries','rates','defaults','overrides','batches','payments','adjustments','audit','targets'];
  for(const name of names){
    const arr=s[name];check(Array.isArray(arr),name+' must be a list.');
    const ids=new Set();for(const item of arr){check(item&&isId(item.id)&&!ids.has(item.id),'Invalid or duplicate '+name+' ID.');ids.add(item.id);}
  }
  const sets=Object.fromEntries(names.map(n=>[n,new Map(s[n].map(v=>[v.id,v]))]));
  const pref=s.settings;
  if (pref && pref.fx === undefined) pref.fx = defaultFx();
  check(typeof pref.sound==='boolean'&&['worked','goal'].includes(pref.streak)&&typeof pref.restWeekends==='boolean','Invalid game settings.');
  for(const t of s.targets)check(['company','project'].includes(t.kind)&&sets[t.kind==='project'?'projects':'companies'].has(t.owner)&&periods.includes(t.period)&&(t.hours===null||(Number.isFinite(t.hours)&&t.hours>0))&&minor(t.money)&&(t.hours!==null||t.money!==null),'Invalid client or project target.');
  check(pref&&pref.fx&&typeof pref.fx.rates==='object'&&currencies.every(c=>Number.isFinite(pref.fx.rates[c])&&pref.fx.rates[c]>0)&&(pref.fx.at===null||isTime(pref.fx.at))&&['built-in','ECB','manual'].includes(pref.fx.source),'Invalid exchange rates.');
  check(pref&&['unique','logged','approved'].includes(pref.basis)&&currencies.includes(pref.currency)&&Number.isInteger(pref.weekStart)&&pref.weekStart>=0&&pref.weekStart<7&&periods.includes(pref.period)&&['dark','light','system'].includes(pref.theme)&&[1,5,6,10,15,30].includes(pref.rounding)&&typeof pref.collapsed==='boolean'&&(pref.backupAt===null||isTime(pref.backupAt)),'Invalid settings.');
  for(const c of s.companies)check(textField(c.name)&&c.name.trim()&&currencies.includes(c.currency)&&/^#[a-f\d]{6}$/i.test(c.color)&&textField(c.notes)&&textField(c.billing),'Invalid company.');
  for(const p of s.projects)check(sets.companies.has(p.companyId)&&(p.currency===undefined||p.currency===null||currencies.includes(p.currency))&&textField(p.name)&&p.name.trim()&&textField(p.notes)&&textField(p.ref)&&typeof p.archived==='boolean'&&typeof p.favourite==='boolean'&&Number.isFinite(p.order)&&isTime(p.recent),'Invalid project.');
  for(const r of s.rates)check(['company','project'].includes(r.kind)&&sets[r.kind==='project'?'projects':'companies'].has(r.owner)&&minor(r.amount)&&currencies.includes(r.currency)&&isTime(r.at),'Invalid rate.');
  const open=new Set(), focusSpans=[];
  for(const e of s.entries){
    check(sets.projects.get(e.projectId)?.companyId===e.companyId&&sets.companies.has(e.companyId),'Unknown project or company.');
    check(isTime(e.start)&&(e.end===null||(isTime(e.end)&&e.end>=e.start))&&['timer','manual'].includes(e.kind),'Invalid session dates.');
    check(minor(e.rate)&&currencies.includes(e.currency)&&typeof e.billable==='boolean'&&statuses.includes(e.status)&&textField(e.notes)&&textField(e.reference)&&Number.isSafeInteger(e.revision)&&e.revision>=0,'Invalid billing or notes.');
    check(e.approved===null||(Number.isSafeInteger(e.approved)&&e.approved>=0&&e.approved<=1e12),'Invalid reportable time.');
    if(e.end===null){check(e.kind==='timer'&&!open.has(e.projectId)&&!sets.projects.get(e.projectId).archived&&e.approved===null&&e.status==='Unreported','Conflicting active session.');open.add(e.projectId);}
    for(const list of [e.segments,e.pauses,e.focus]){
      check(Array.isArray(list),'Invalid interval list.');let last=e.start;
      for(const pair of list){
        check(Array.isArray(pair)&&pair.length===2,'Invalid interval.');
        const [a,b]=pair;check(isTime(a)&&a>=last&&a<=(e.end??Infinity)&&(b===null?e.end===null:isTime(b)&&b>=a&&b<=(e.end??Infinity)),'Invalid interval boundary.');last=b??Infinity;
      }
    }
    check(e.kind!=='manual'||(e.end!==null&&!e.focus.length),'Invalid manual focus.');
    const parts=[...e.segments,...e.pauses].sort((a,b)=>a[0]-b[0]||(a[1]??Infinity)-(b[1]??Infinity));
    let cursor=e.start;for(const [a,b] of parts){check(a===cursor,'Running and break intervals must cover the session exactly.');cursor=b??Infinity;}
    check(parts.length&&cursor===(e.end??Infinity),'Incomplete session timeline.');
    for(const [a,b] of e.focus){check(e.segments.some(([x,y])=>a>=x&&(b??Infinity)<=(y??Infinity)),'Focus outside working time.');if((b??Infinity)>a)focusSpans.push([a,b??Infinity]);}
    if(e.approved>0)check(lengthOf(clip(e.segments,all,e.end??e.start))>0,'Positive reportable time needs recorded work.');
  }
  focusSpans.sort((a,b)=>a[0]-b[0]);for(let i=1;i<focusSpans.length;i++)check(focusSpans[i][0]>=focusSpans[i-1][1],'Focus intervals overlap.');
  for(const name of ['defaults','overrides']){
    const keys=new Set();for(const g of s[name]){
      const key=[g.period,g.key,g.currency].join('|');
      check(periods.includes(g.period)&&currencies.includes(g.currency)&&keyDate(localDate(g.key))===g.key&&(g.hours===null||(Number.isFinite(g.hours)&&g.hours>0))&&minor(g.money)&&g.money!==0&&!keys.has(key),'Invalid or duplicate goal.');keys.add(key);
    }
  }
  for (const a of s.adjustments) {
    const valid = n => n === null || (Number.isSafeInteger(n) && n >= 0 && n <= 1e12);
    check(isId(a.entryId) && isTime(a.at) && valid(a.previous) && valid(a.approved), 'Invalid review history.');
  }
  const paid=new Set();for(const p of s.payments){const e=sets.entries.get(p.entryId);check(e&&e.status==='Paid'&&!paid.has(p.entryId)&&p.currency===e.currency&&minor(p.amount)&&p.amount!==null&&isTime(p.at),'Invalid payment.');paid.add(p.entryId);}
  for(const b of s.batches)check(isTime(b.at)&&['CSV','Print'].includes(b.type)&&Array.isArray(b.entryIds)&&b.entryIds.every(isId)&&Array.isArray(b.range)&&b.range.length===2&&b.range.every(isTime)&&b.range[1]>b.range[0],'Invalid reporting batch.');
  for(const a of s.audit)check(isTime(a.at)&&textField(a.action)&&textField(a.entity),'Invalid audit event.');
  return s;
}
export function encodeBackup(s,at=Date.now()){return JSON.stringify({application:'TimeLedger',exportedAt:new Date(at).toISOString(),data:validate(s)},null,2);}
export function decodeBackup(text){const b=JSON.parse(text);requireThat(b.application==='TimeLedger'&&typeof b.exportedAt==='string','This is not a TimeLedger backup.');return validate(b.data);}
export function mergeBackup(current,incoming){
  validate(incoming);const result=structuredClone(current);
  for(const name of Object.keys(result).filter(k=>Array.isArray(result[k]))){
    const ids=new Map(result[name].map(row=>[row.id,row]));
    for(const row of incoming[name]){
      const old=ids.get(row.id);
      if(old){requireThat(canonical(old)===canonical(row),'Merge conflict in '+name+'. Existing data is untouched. Use Replace to choose the backup version.');}
      else result[name].push(structuredClone(row));
    }
  }
  return validate(result);
}
function canonical(v){if(!v||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
// Three-way merge for device sync. `base` is the copy both sides last agreed on (an empty
// state on first sign-in). Edits on one side win; deletions apply unless the other side
// edited the record; a record edited on both sides keeps the higher revision, else local.
export function syncMerge(base, local, remote) {
  const same=(a,b)=>canonical(a)===canonical(b);
  const result=structuredClone(local);
  const names=new Set([...Object.keys(local),...Object.keys(remote)].filter(k=>Array.isArray(local[k]??remote[k])));
  for(const name of names){
    const B=new Map((base?.[name]??[]).map(r=>[r.id,r])), L=local[name]??[], R=new Map((remote[name]??[]).map(r=>[r.id,r]));
    const out=[];const seen=new Set();
    for(const l of L){
      seen.add(l.id);const r=R.get(l.id), b=B.get(l.id);
      if(r===undefined){if(!b||!same(b,l))out.push(l);continue;}
      if(same(l,r)||same(r,b))out.push(l);
      else if(same(l,b))out.push(structuredClone(r));
      else out.push((r.revision??-1)>(l.revision??-1)?structuredClone(r):l);
    }
    for(const r of R.values()){
      if(seen.has(r.id))continue;const b=B.get(r.id);
      if(!b||!same(b,r))out.push(structuredClone(r));
    }
    result[name]=out;
  }
  const bs=base?.settings??{}, ls=local.settings, rs=remote.settings;
  for(const k of new Set([...Object.keys(ls),...Object.keys(rs)]))
    if(!same(ls[k],rs[k])&&same(ls[k],bs[k])&&rs[k]!==undefined)result.settings[k]=structuredClone(rs[k]);
  if(local.demoOffset===undefined)delete result.demoOffset;
  // A payment only belongs to a paid entry in the same currency.
  const entries=new Map(result.entries.map(e=>[e.id,e]));
  result.payments=result.payments.filter(p=>{const e=entries.get(p.entryId);return e&&e.status==='Paid'&&e.currency===p.currency;});
  result.payments=result.payments.filter((p,i,a)=>a.findIndex(q=>q.entryId===p.entryId)===i);
  return validate(result);
}
