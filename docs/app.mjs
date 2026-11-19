import * as C from './core.mjs';
import {openLedger} from './storage.mjs';
import {createSync} from './sync.mjs';
import {syncRepo} from './config.mjs';
import * as G from './game.mjs';
import {play as sfx, soundSetting} from './sound.mjs';
import {icon} from './icons.mjs';
const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const example=new URLSearchParams(location.search).get('example')==='1';
const now=()=>Date.now()+(example?(s?.demoOffset??0):0);
const money=(minor,cc=s.settings.currency,short=false)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:cc,minimumFractionDigits:short&&minor%100===0?0:2,maximumFractionDigits:2}).format(minor/100);
const mins=ms=>Math.round(ms/C.MIN);
const dur=ms=>{const n=Math.floor(Math.max(0,ms)/C.MIN);return n>=60?Math.floor(n/60)+'h '+String(n%60).padStart(2,'0')+'m':n+'m';};
const elapsed=ms=>{const n=Math.floor(Math.max(0,ms)/1000);return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(x=>String(x).padStart(2,'0')).join(':');};
const dateLabel=(at,opts={day:'numeric',month:'short',year:'numeric'})=>new Date(at).toLocaleDateString('en-GB',opts);
const time=at=>new Date(at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});
const cap=v=>v[0].toUpperCase()+v.slice(1);
const opt=(val,label,selected)=>'<option value="'+h(val)+'" '+(String(val)===String(selected)?'selected':'')+'>'+h(label)+'</option>';
const options=(arr,sel)=>arr.map(x=>opt(x,x,sel)).join('');
const button=(action,label,ico='',cls='secondary',extra='')=>'<button type="button" class="'+cls+'" data-action="'+action+'" '+extra+'>'+(ico?icon(ico,17):'')+h(label)+'</button>';
const ib=(action,label,ico,extra='',cls='icon-btn')=>'<button type="button" data-action="'+action+'" class="'+cls+'" aria-label="'+h(label)+'" title="'+h(label)+'" '+extra+'>'+icon(ico,18)+'</button>';
const did=id=>'data-id="'+h(id)+'"';
const field=(label,control,wide=false)=>'<label class="field '+(wide?'wide':'')+'"><span>'+label+'</span>'+control+'</label>';
const input=(name,val='',type='text',attr='')=>'<input name="'+name+'" type="'+type+'" value="'+h(val)+'" '+attr+'>';
const select=(name,content,attr='')=>'<select name="'+name+'" '+attr+'>'+content+'</select>';
const checks=(name,label,checked=false)=>'<label class="check"><input type="checkbox" name="'+name+'" '+(checked?'checked':'')+'><span>'+h(label)+'</span></label>';
const textArea=(name,val)=>'<textarea rows="2" name="'+name+'">'+h(val)+'</textarea>';
const hint=text=>'<p class="hint">'+h(text)+'</p>';
const amt=(n)=>n===null||n===undefined?'':(n/100).toFixed(2);
function decimal(str,nullable=true){
  const v=String(str??'').trim();if(!v&&nullable)return null;
  C.requireThat(/^\d+(\.\d{1,2})?$/.test(v),'Enter an amount with at most two decimal places.');
  const [a,b='']=v.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));
}
const section=(title,count,action='')=>'<div class="section-head"><h2>'+title+(count!==null?'<span class="count">'+count+'</span>':'')+'</h2>'+action+'</div>';
const navs=[['Today','today'],['Timesheet','sheet'],['Goals','target'],['Projects','projects'],['Reports','reports']];
const sheet=$('#sheet'),body=$('#sheet-body'),app=$('#app');
let s,db,view='Today',swReady=false,swIssue='',formSave=null,projectTab='Projects',showArchived=false,toastTimeout,selectedDate='',busy=false,filter;
let lastDialogFocus=null,backupPending=null,formChange=null,exportPending=null,sync=null,signInPending=null,syncTimer=null;
const bases={unique:'Unique clock time',logged:'Total project time',approved:'Reviewed reportable time'};
const glyphs=['layers','web','orbit','pen','grid','projects'];
function projectInfo(p){
  const c=C.byId(s.companies,p.companyId);
  return {c,color:c.color,ico:glyphs[s.projects.indexOf(p)%glyphs.length]??'projects'};
}
function tile(p,small=false){const {color,ico}=projectInfo(p);return '<span class="project-icon '+(small?'small':'')+'" style="--company:'+color+'">'+icon(ico,small?18:21)+'</span>';}
function toast(text){const el=$('#notice');el.textContent=text;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3300);}
function showDialog(title,html,save=null,submit='Save changes',foot='',change=null){
  if(!sheet.open)lastDialogFocus=document.activeElement;
  formSave=save;formChange=change;
  body.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+h(title)+'</h2>'+ib('close','Close','close')+'</div><form id="editform"><div class="dialog-content">'+html+'<p id="form-error" role="alert"></p></div>'+(save?'<div class="dialog-foot">'+foot+'<button class="primary" type="submit">'+h(submit)+'</button></div>':'')+'</form>';
  sheet.setAttribute('aria-labelledby','dialog-title');
  if(!sheet.open)sheet.showModal();
  body.scrollTop=0;$('.dialog-content')?.scrollTo(0,0);
}
function closeDialog(){if(sheet.open)sheet.close();formSave=null;formChange=null;}
sheet.addEventListener('close',()=>{if(lastDialogFocus?.isConnected)lastDialogFocus.focus();setTimeout(runCelebrations,250);});
sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
function errorMessage(err){const msg=err?.message??String(err);if(sheet.open&&$('#form-error'))$('#form-error').textContent=msg;else toast(msg);}
async function write(fn,action,entity=''){
  s=await db.write(st=>{const at=Date.now()+(example?(st.demoOffset??0):0);const result=fn(st,at);const next=result??st;if(action)C.audit(next,action,at,entity);return next;});
  render();scheduleSync();return s;
}
function scheduleSync(delay=5000){if(!sync?.account)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync.syncNow(),delay);}
// Every currency, converted into the goal currency at the stored exchange rates.
const combined=amounts=>C.totalIn(amounts,s.settings.currency,s.settings.fx);
function fxNote(amounts){
  const other=Object.keys(amounts).filter(k=>k!==s.settings.currency&&amounts[k]);
  return other.length?'Includes '+other.map(k=>money(amounts[k],k)).join(' + ')+' converted to '+s.settings.currency:'';
}
function syncLabel(){
  if(example)return 'Sample data';if(!sync?.account)return 'On this device';
  return ({syncing:'Syncing…',offline:'Offline · will sync',error:'Sync problem'})[sync.status.state]??'Synced · '+sync.account.user;
}
function dialogSubmit(e){
  e.preventDefault();if(!formSave||busy)return;
  const form=e.currentTarget, data=Object.fromEntries(new FormData(form));
  const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;
  busy=true;Promise.resolve().then(()=>formSave(data,form)).catch(errorMessage).finally(()=>{busy=false;if(submit)submit.disabled=false;});
}
document.addEventListener('submit',e=>{if(e.target.id==='editform'){e.preventDefault();dialogSubmit({preventDefault(){},currentTarget:e.target});}});
document.addEventListener('change',e=>{if(e.target.closest('#editform'))formChange?.(e.target,e.target.form);});
const setView=name=>{closeDialog();view=name;location.hash=name.toLowerCase();render();window.scrollTo(0,0);};
addEventListener('hashchange',()=>{const v=navs.find(([n])=>'#'+n.toLowerCase()===location.hash);if(v&&view!==v[0]){view=v[0];render();}});
function navHtml(){return navs.map(([n,i])=>'<button data-action="nav" data-page="'+n+'" class="navitem '+(view===n?'selected':'')+'" '+(view===n?'aria-current="page"':'')+'>'+icon(i,20)+'<span>'+n+'</span></button>').join('');}
function workspaceButton(){return '<button class="workspace" data-action="workspace"><span class="workspace-avatar">'+icon(example?'layers':'user',19)+'</span><span><strong>'+(example?'Example workspace':'Personal workspace')+'</strong><small class="sync-label">'+h(syncLabel())+'</small></span>'+icon('down',15)+'</button>';}
function render(){
  if(!s)return;
  document.documentElement.dataset.theme=s.settings.theme;
  selectedDate=C.keyDate(now());
  const today=view==='Today', headerDate=dateLabel(now(),{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  app.innerHTML='<aside class="sidebar"><div class="brand"><img src="./mark.png" alt=""><span>TimeLedger</span></div><div class="nav-caption">Workspace</div><nav aria-label="Main">'+navHtml()+'</nav>'+(example?'':levelChip('side-level'))+'<div class="side-bottom">'+button('backup','Backup & restore','backup','side-link')+button('settings','Settings','settings','side-link')+workspaceButton()+'</div></aside>'+
    '<div class="mobile-brand"><div class="brand"><img src="./mark.png" alt="">TimeLedger</div>'+levelChip('mobile-level')+ib('workspace',example?'Example workspace':'Personal workspace',example?'layers':'user')+'</div>'+
    '<main id="main" tabindex="-1"><div class="main-wrap"><header class="page-head"><div><div class="eyebrow">'+(today?icon('today',14)+h(headerDate):'Workspace')+'</div><h1>'+view+'</h1></div><div class="head-actions">'+(view==='Projects'?button('new-project','New project','plus','primary'):button('entry','Add entry','plus','primary'))+ib('settings','Settings','settings','','settings-top')+'</div></header>'+
    (!navigator.onLine?'<div class="offline">'+icon('check',15)+'Offline · saved on this device</div>':'')+
    (today?todayPage():view==='Projects'?projectsPage():view==='Goals'?goalsPage():recordsPage())+
    '</div></main><nav class="mobile-nav" aria-label="Mobile navigation">'+navHtml()+'</nav>';
  if(today||view==='Goals')tick();
  countUp();checkCelebrations();
}
function goalsPanel(){
  const p=s.settings.period,range=C.periodRange(p,now(),s.settings.weekStart),sum=C.summary(s.entries,range,now()),goal=C.goal(s,p,now());
  const units=sum[s.settings.basis],earn=combined(sum.money),note=fxNote(sum.money);
  function metric(label,ico,value,current,target,remaining,moneyMode){
    const progress=C.progress(current,target);
    return '<div class="metric '+(moneyMode?'earn':'hours')+'"><div class="metric-name">'+icon(ico,16)+label+'</div><div class="metric-number">'+value+'</div>'+
      (progress?'<div class="progress-track"><i style="width:'+progress.bar+'%"></i></div><div class="progress-caption"><span>of '+(moneyMode?money(target,undefined,true):dur(target))+' goal</span><b>'+progress.percent+'%</b></div><div class="remaining">'+remaining(progress.remaining)+' remaining</div>':'<div class="no-target">No target set</div>')+'</div>';
  }
  return '<section class="overview '+(s.settings.collapsed?'collapsed':'')+'"><div class="overview-head"><div class="overview-title">'+icon('target',19)+'<h2>Work overview</h2></div><div class="periods" aria-label="Goal period">'+C.periods.map(n=>'<button data-action="period" data-value="'+n+'" aria-pressed="'+(n===p)+'">'+cap(n)+'</button>').join('')+'</div>'+ib('collapse',s.settings.collapsed?'Expand work overview':'Collapse work overview',s.settings.collapsed?'down':'up','','overview-toggle')+'</div>'+
    (s.settings.collapsed?'':'<div class="metrics">'+metric('Working hours','clock',dur(units),units,goal.hours===null?null:goal.hours*C.HOUR,dur,false)+metric('Estimated earnings','money','<span data-count="'+earn+'" data-key="ov-earn" data-fmt="money">'+money(earn)+'</span>',earn,goal.money,v=>money(v,undefined,true),true)+'</div><div class="overview-foot"><span>'+icon('clock',13)+h(bases[s.settings.basis])+'</span>'+button('goals','Edit goals','sliders','hero-link')+'</div>'+
    (note?'<p class="fx-note">'+h(note)+'</p>':'')+(sum.incomplete.size?'<div class="estimate-alert">Estimate incomplete · missing hourly rate</div>':''))+'</section>';
}
function badge(text,cls=''){return '<span class="badge '+cls+'">'+h(text)+'</span>';}
function stateLabel(e){const st=C.conditionOf(e);return '<span class="state-label '+st.toLowerCase()+'"><i></i>'+st+'</span>';}
function quickCard(p){
  const e=C.active(s,p.id),{c}=projectInfo(p);
  return '<div class="quick-card '+(C.focused(e)?'is-focused':'')+'"><button class="quick-main" data-action="quick" '+did(p.id)+'>'+tile(p)+'<strong>'+h(p.name)+'</strong><span class="company-name">'+h(c.name)+'</span><span class="quick-bottom">'+stateLabel(e)+(C.focused(e)?'<span class="quick-focus">'+icon('focus',12)+' Focus</span>':'')+'</span></button>'+ib('project-menu','Actions for '+p.name,'more',did(p.id),'tile-more')+'</div>';
}
function activeRow(e){
  const p=C.byId(s.projects,e.projectId),run=C.conditionOf(e)==='Running';
  return '<div class="timer-row">'+tile(p)+'<div class="timer-info"><div class="timer-title"><strong>'+h(p.name)+'</strong>'+(C.focused(e)?'<span class="focus-tag">'+icon('focus',12)+' In focus</span>':'')+'</div><div class="row-meta">'+h(projectInfo(p).c.name)+'<span>·</span>'+stateLabel(e)+'</div></div>'+(e.rate!==null?'<span class="session-earn '+(run?'on':'')+'" data-live="'+e.id+'">+'+money(G.live(s,now()).per[e.id]??0,e.currency)+'</span>':'')+'<div class="time-read '+(run?'':'paused')+'" data-elapsed="'+e.id+'">'+elapsed(C.lengthOf(C.clip(e.segments,[-Infinity,Infinity],now())))+'</div><div class="timer-actions">'+ib(run?'pause':'resume',(run?'Pause ':'Resume ')+p.name,run?'pause':'play',did(p.id),'timer-btn')+ib('stop','Stop '+p.name,'stop',did(p.id),'timer-btn')+ib('project-menu','Timer actions for '+p.name,'more',did(p.id),'timer-more')+'</div></div>';
}
function empty(ico,title,desc,action='',label=''){return '<div class="empty"><span class="empty-icon">'+icon(ico,24)+'</span><div><strong>'+h(title)+'</strong><p>'+h(desc)+'</p></div>'+(action?button(action,label,'plus','secondary'):'')+'</div>';}
function dailyRow(e){
  const p=C.byId(s.projects,e.projectId),c=C.byId(s.companies,e.companyId), a=C.entryStats(e,C.periodRange('day',now()),now());
  return '<button class="daily-row" data-action="entry" '+did(e.id)+'><span class="log-time">'+time(e.start)+' – '+time(e.end)+'</span><span class="log-project"><i class="company-dot" style="background:'+c.color+'"></i><span><strong>'+h(p.name)+'</strong><small>'+h(c.name)+'</small></span></span><span class="log-duration">'+dur(a.logged)+'</span><span class="log-status">'+badge(e.status,e.status.toLowerCase())+'</span>'+icon('right',15)+'</button>';
}
function todayPage(){
  const fav=C.favourites(s),active=s.entries.filter(e=>e.end===null).sort((a,b)=>Number(C.focused(b))-Number(C.focused(a))||a.start-b.start);
  const day=C.periodRange('day',now()),log=s.entries.filter(e=>e.end!==null&&e.start<day[1]&&e.end>day[0]).sort((a,b)=>b.start-a.start);
  return goalsPanel()+playerCard()+'<section>'+section('Quick switch',null,button('favourites','Manage','sliders','text-btn'))+
    (fav.length?'<div class="quick-strip">'+fav.map(quickCard).join('')+'</div>':empty('bolt','Pin your go-to projects','Keep your most-used project timers one tap away.',s.projects.length?'favourites':'new-project',s.projects.length?'Pin projects':'Create a project'))+'</section>'+
    '<section>'+section('Active timers',active.length,button('choose-timer','Start timer','play','secondary compact'))+
    '<div class="card">'+(active.length?active.map(activeRow).join(''):empty('timer','No active timers','Start a project timer when you begin working.'))+'</div></section>'+
    '<section>'+section('Daily log',log.length,button('today-sheet','View timesheet','','text-btn'))+
    '<div class="card">'+(log.length?'<div class="log-head"><span>Time</span><span>Project</span><span>Logged</span><span>Status</span></div>'+log.map(dailyRow).join(''):empty('log','No completed entries today','Stopped timers and manual entries appear here.'))+'</div></section>'+
    (!example&&!s.projects.length?'<button class="example-link" data-action="example">'+icon('layers',16)+' Explore the example workspace</button>':'')+
    (!example&&s.entries.length&&(!s.settings.backupAt||Date.now()-s.settings.backupAt>7*86400000)?'<button class="example-link" data-action="backup">'+icon('backup',16)+' Save a backup of your ledger</button>':'');
}
function tick(){
  if(!s||!['Today','Goals'].includes(view))return;
  if(selectedDate!==C.keyDate(now())){coinBucket=null;render();return;}
  liveTick();
  for(const el of $$('[data-elapsed]')){const e=C.byId(s.entries,el.dataset.elapsed);if(e)el.textContent=elapsed(C.lengthOf(C.clip(e.segments,[-Infinity,Infinity],now())));}
  const minute=Math.floor(now()/C.MIN);
  if(tick.minute!==minute){tick.minute=minute;const panel=$('.overview');if(panel&&!panel.contains(document.activeElement)){panel.outerHTML=goalsPanel();countUp();}const pc=$('.player:not(.big)');if(pc&&!pc.contains(document.activeElement))pc.outerHTML=playerCard();for(const el of $$('.side-level,.mobile-level'))el.outerHTML=levelChip(el.classList[0]);checkCelebrations();}
}
function projectsPage(){
  const list=s.projects.filter(p=>p.archived===showArchived).sort((a,b)=>a.name.localeCompare(b.name));
  const selector='<div class="tabs">'+['Projects','Companies'].map(v=>'<button data-action="project-tab" data-value="'+v+'" aria-pressed="'+(v===projectTab)+'">'+v+'</button>').join('')+'</div>';
  if(projectTab==='Companies')return selector+'<section>'+section('Companies',s.companies.length,button('new-company','Add company','plus','secondary'))+'<div class="card">'+(s.companies.map(c=>'<button class="list-row" data-action="company" '+did(c.id)+'><i class="company-dot" style="background:'+c.color+'"></i><span class="grow"><strong>'+h(c.name)+'</strong><small>'+s.projects.filter(p=>p.companyId===c.id).length+' projects · '+c.currency+'</small></span>'+icon('edit',17)+'</button>').join('')||empty('building','Add your first company','Set a company colour, currency and optional hourly rate.','new-company','Add company'))+'</div></section>';
  return selector+'<section>'+section(showArchived?'Archived projects':'Active projects',list.length,button('archived',showArchived?'Show active':'Show archived','','text-btn'))+'<div class="card">'+(list.map(p=>'<div class="list-row">'+tile(p)+'<button class="plain grow left" data-action="project" '+did(p.id)+'><strong>'+h(p.name)+'</strong><small>'+h(projectInfo(p).c.name)+(p.ref?' · '+h(p.ref):'')+'</small></button>'+(p.favourite?icon('pin',15):'')+(p.archived?'':ib('quick','Open timer for '+p.name,'timer',did(p.id)))+ib('project-menu','Actions for '+p.name,'more',did(p.id))+'</div>').join('')||empty('projects',showArchived?'No archived projects':'Create your first project',showArchived?'Archived projects keep their work history.':'Group projects by company to start tracking time.',showArchived?'':'new-project','New project'))+'</div></section>';
}
function initFilter(){return {period:'week',anchor:C.keyDate(now()),from:C.keyDate(now()),to:C.keyDate(now()),company:'',project:'',status:''};}
function rangeFor(){
  if(filter.period!=='custom')return C.periodRange(filter.period,+C.localDate(filter.anchor),s.settings.weekStart);
  const end=C.localDate(filter.to);end.setDate(end.getDate()+1);return [+C.localDate(filter.from),+end];
}
function filtered(range){
  return s.entries.filter(e=>e.end!==null&&e.start<range[1]&&e.end>=range[0]&&(e.end>range[0]||e.start===e.end)&&(!filter.company||e.companyId===filter.company)&&(!filter.project||e.projectId===filter.project)&&(!filter.status||e.status===filter.status)).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
}
function allAmounts(obj,missing=new Set()){
  return [...new Set([...Object.keys(obj),...missing])].map(k=>money(obj[k]??0,k)+(missing.has(k)?' (incomplete)':'')).join(' / ')||money(0);
}
function filterUI(){
  const f=filter,ps=s.projects.filter(p=>!f.company||p.companyId===f.company);
  return '<div class="filters card">'+field('View',select('period',C.periods.slice(0,3).concat('custom').map(n=>opt(n,cap(n),f.period)).join('')))+
  (f.period==='custom'?field('From',input('from',f.from,'date','required'))+field('Through',input('to',f.to,'date','required')):field('Containing date',input('anchor',f.anchor,'date','required')))+
  field('Company',select('company',opt('','All companies',f.company)+s.companies.map(c=>opt(c.id,c.name,f.company)).join('')))+
  field('Project',select('project',opt('','All projects',f.project)+ps.map(p=>opt(p.id,p.name,f.project)).join('')))+
  field('Status',select('status',opt('','All statuses',f.status)+options(C.statuses,f.status)))+'</div>';
}
function reportRows(entries,range,print=false){
  const hits=C.overlaps(s,range,now());
  return entries.map(e=>{
    const p=C.byId(s.projects,e.projectId),c=C.byId(s.companies,e.companyId),a=C.entryStats(e,range,now());
    return '<article class="report-entry"><div class="entry-top">'+tile(p,true)+'<div class="grow"><strong>'+h(p.name)+'</strong><small>'+h(c.name)+' · '+dateLabel(e.start)+'</small></div>'+badge(e.status,e.status.toLowerCase())+(print?'':ib('entry','Edit '+p.name,'edit',did(e.id)))+'</div><div class="entry-data">'+
    [['Session',time(e.start)+' – '+time(e.end)+(C.keyDate(e.start)!==C.keyDate(e.end)?' ('+dateLabel(e.end)+')':'')],['Logged',dur(a.logged)],['Breaks',dur(a.breakMs)],['Focus',e.focus.length?dur(a.focus):'Unrecorded'],['Reportable',a.approved===null?'Awaiting review':dur(a.approved)],['Rate',e.rate===null?'Not set':money(e.rate,e.currency)+'/h'],['Estimate',!e.billable?'Non-billable':a.incomplete?'Rate missing':a.approved===null?'Awaiting review':money(a.amount,e.currency)]].map(([k,v])=>'<div><small>'+k+'</small><span>'+h(v)+'</span></div>').join('')+'</div>'+
    (hits.has(e.id)?badge('Overlap','overlap'):'')+(e.notes?'<p class="entry-note">'+h(e.notes)+'</p>':'')+(e.reference?'<small>Reference · '+h(e.reference)+'</small>':'')+'</article>';
  }).join('');
}
function grouped(entries,range){
  if(!entries.length)return '';
  const groups=new Map();for(const e of entries){if(!groups.has(e.companyId))groups.set(e.companyId,new Map());const ps=groups.get(e.companyId);if(!ps.has(e.projectId))ps.set(e.projectId,[]);ps.get(e.projectId).push(e);}
  const row=(name,rows,cls)=>{const a=C.summary(rows,range,now());return '<tr class="'+cls+'"><th>'+h(name)+'</th><td>'+dur(a.logged)+'</td><td>'+dur(a.approved)+'</td><td>'+h(allAmounts(a.money,a.incomplete))+'</td></tr>';};
  return '<section>'+section('Company & project totals',null)+'<div class="card table-wrap"><table><thead><tr><th>Company / project</th><th>Logged</th><th>Reportable</th><th>Estimated</th></tr></thead><tbody>'+[...groups].map(([cid,ps])=>row(C.byId(s.companies,cid).name,[...ps.values()].flat(),'subtotal')+[...ps].map(([pid,rows])=>row(C.byId(s.projects,pid).name,rows,'detail')).join('')).join('')+'</tbody></table></div></section>';
}
function recordsPage(){
  const report=view==='Reports',range=rangeFor(),entries=filtered(range),sum=C.summary(entries,range,now());
  const label=dateLabel(range[0])+' – '+dateLabel(range[1]-1);
  const payments={};for(const p of s.payments){const e=C.byId(s.entries,p.entryId);if(p.at>=range[0]&&p.at<range[1]&&(!filter.company||e.companyId===filter.company)&&(!filter.project||e.projectId===filter.project)&&(!filter.status||e.status===filter.status))payments[p.currency]=(payments[p.currency]??0)+p.amount;}
  const metrics=[['Logged time',dur(sum.logged)],['Unique clock time',dur(sum.unique)],['Overlap excess',dur(sum.overlap)],['Reviewed reportable',dur(sum.approved)]];
  if(report)metrics.push(['Estimated billable',allAmounts(sum.money,sum.incomplete)],['Estimated total in '+s.settings.currency,money(combined(sum.money))+(sum.incomplete.size?' (incomplete)':'')],['Invoiced incl. paid',allAmounts(sum.invoiced,sum.invoicedIncomplete)],['Confirmed receipts¹',allAmounts(payments)]);
  return filterUI()+'<section>'+section(label,null)+'<div class="stat-grid">'+metrics.map(([k,v])=>'<div class="stat"><small>'+k+'</small><strong>'+h(v)+'</strong></div>').join('')+'</div>'+(report?hint('¹ Confirmed receipts use the payment date. Work totals use the session dates. Open timers appear on Today.'):'')+'</section>'+
    '<section>'+section('Work entries',entries.length,report?'<div class="toolbar">'+button('export','CSV','download','secondary compact','data-value="CSV" '+(!entries.length?'disabled':''))+button('export','Print','print','secondary compact','data-value="Print" '+(!entries.length?'disabled':''))+'</div>':'')+'<div class="card">'+(entries.length?reportRows(entries,range):empty('sheet','No entries in this view','Choose another date range or add a work entry.','entry','Add entry'))+'</div></section>'+grouped(entries,range);
}
document.addEventListener('change',e=>{if(!e.target.closest('.filters'))return;const {name,value}=e.target;if(!value&&['anchor','from','to'].includes(name))return render();filter[name]=value;if(name==='company')filter.project='';if(filter.from>filter.to){if(name==='from')filter.to=filter.from;else filter.from=filter.to;}render();});
function companyForm(id='',after=null){
  const c=C.byId(s.companies,id),r=c?C.rateAt(s,{id:'',companyId:c.id},now()):null;
  showDialog(c?'Edit company':'New company','<div class="form-grid">'+field('Company name',input('name',c?.name,'text','required maxlength="160"'),true)+field('Colour',input('color',c?.color??'#5377af','color'))+
    field('Currency',select('currency',options(C.currencies,c?.currency??'GBP'),c?'disabled':''))+field('Default hourly rate',input('rate',amt(r?.rate),'number','min="0" max="100000000" step="0.01" placeholder="Optional"'),true)+field('Billing information',textArea('billing',c?.billing),true)+field('Notes',textArea('notes',c?.notes),true)+'</div>',async d=>{
      const newId=id||C.uid();await write((st,at)=>{
        const current=C.byId(st.companies,newId),cc=current?.currency??d.currency;
        if(c)C.requireThat(JSON.stringify(c)===JSON.stringify(current)&&C.rateAt(st,{id:'',companyId:id},at).rate===r.rate,'Company changed in another window. Reopen it.');
        const record={id:newId,name:d.name.trim(),color:d.color,currency:cc,notes:d.notes,billing:d.billing};
        if(current)Object.assign(current,record);else st.companies.push(record);
        const rate=decimal(d.rate);if(!c||r.rate!==rate)C.setRate(st,'company',newId,rate,cc,c?at:0);
      },c?'Edit company':'Create company',newId);
      if(after)after(newId);else closeDialog();toast('Company saved');
    },c?'Save company':'Create company');
}
function projectForm(id='',selectedCompany='',after=null){
  const p=C.byId(s.projects,id),chosen=p?.companyId??selectedCompany;
  const oldRate=p?s.rates.filter(r=>r.kind==='project'&&r.owner===p.id&&r.at<=now()).sort((a,b)=>b.at-a.at)[0]?.amount??null:null;
  const locked=p&&s.entries.some(e=>e.projectId===id);
  const companyCtrl=s.companies.length?select('companyId',s.companies.map(c=>opt(c.id,c.name,chosen)).join(''),p?'disabled':''):input('companyName','','text','required placeholder="Company name" maxlength="160"');
  showDialog(p?'Edit project':'New project','<div class="form-grid">'+field('Project name',input('name',p?.name,'text','required maxlength="160" placeholder="e.g. Brand identity"'),true)+field('Company',companyCtrl,true)+
    field('Project reference',input('ref',p?.ref,'text','placeholder="Optional"'))+field('Hourly rate override',input('rate',amt(oldRate),'number','min="0" max="100000000" step="0.01" placeholder="Company default"'))+
    field('Notes',textArea('notes',p?.notes),true)+'</div>'+checks('fav','Pin to Quick switch',p?.favourite??true)+(p?checks('archived','Archive project',p.archived):'')+(locked?hint('Historical entries retain their company and recorded rate.'):''),
    async(d,form)=>{
      const newId=id||C.uid();
      if(p&&!p.archived&&form.archived.checked&&!confirm('Archive this project and remove it from Quick switch? Its entries will remain available.'))return;
      await write((st,at)=>{
        let cid=p?.companyId??d.companyId;
        if(!cid){
          cid=C.uid();st.companies.push({id:cid,name:d.companyName.trim(),color:'#7255ac',currency:st.settings.currency,notes:'',billing:''});
          C.setRate(st,'company',cid,null,st.settings.currency,0);
        }
        const cur=C.byId(st.projects,newId),archived=!!d.archived;
        if(p)C.requireThat(JSON.stringify(cur)===JSON.stringify(p),'Project changed in another window. Reopen it.');
        C.requireThat(!archived||!C.active(st,newId),'Stop this project timer before archiving.');
        const record={id:newId,companyId:cid,name:d.name.trim(),ref:d.ref,notes:d.notes,favourite:!archived&&!!d.fav,archived,order:cur?.order??Math.max(-1,...st.projects.map(x=>x.order))+1,recent:cur?.recent??0};
        if(cur)Object.assign(cur,record);else st.projects.push(record);
        const rate=decimal(d.rate);if(rate!==oldRate)C.setRate(st,'project',newId,rate,C.byId(st.companies,cid).currency,p?at:0);
      },p?'Edit project':'Create project',newId);
      if(after)after(newId);else closeDialog();toast('Project saved');
    },p?'Save project':'Create project',!p&&s.companies.length?button('new-company-inline','New company','plus','text-btn'):'');
}
function favouritesForm(){
  const pins=C.favourites(s),others=s.projects.filter(p=>!p.archived&&!p.favourite);
  const row=(p,i,pinned)=>'<div class="list-row">'+tile(p,true)+'<div class="grow"><strong>'+h(p.name)+'</strong><small>'+h(projectInfo(p).c.name)+'</small></div>'+(pinned?ib('fav-up','Move '+p.name+' earlier','up',did(p.id)+(i===0?' disabled':''))+ib('fav-down','Move '+p.name+' later','down',did(p.id)+(i===pins.length-1?' disabled':''))+ib('pin','Unpin '+p.name,'close',did(p.id)):ib('pin','Pin '+p.name,'plus',did(p.id)))+'</div>';
  showDialog('Quick switch',hint('Pin projects and put your most-used shortcuts first.')+(pins.length?'<h3>Pinned projects</h3>'+pins.map((p,i)=>row(p,i,true)).join(''):'')+(others.length?'<h3>Available projects</h3>'+others.map((p,i)=>row(p,i,false)).join(''):'')+(!s.projects.some(p=>!p.archived)?empty('pin','No active projects','Create a project to pin it here.','new-project','New project'):''));
}
function menu(p,quick=false){
  const e=C.active(s,p.id),st=C.conditionOf(e),id=did(p.id),run=st==='Running',paused=st==='Paused';
  const cmd=(a,l,i)=>button(a,l,i,'menu-action',id);
  const actions=[];
  if(!p.archived){
    if(!e)actions.push(cmd('start-focus','Start and focus','focus'),cmd('start','Start timer','play'));
    if(paused)actions.push(cmd('resume-focus','Resume and focus','focus'),cmd('resume','Resume timer','play'));
    if(run){actions.push(C.focused(e)?cmd('clear-focus','Clear focus','focus'):cmd('focus','Focus project','focus'),cmd('pause','Pause timer','pause'));}
    if(e)actions.push(cmd('stop','Stop session','stop'));
  }
  if(!quick)actions.push(cmd('project','Edit project','edit'),...(!p.archived?[cmd('menu-pin',p.favourite?'Remove from favourites':'Pin to Quick switch','pin')]:[]));
  showDialog(p.name,'<div class="menu-project">'+tile(p)+'<div>'+h(projectInfo(p).c.name)+'<small>'+st+(C.focused(e)?' · In focus':'')+'</small></div></div>'+actions.join(''));
}
function chooseTimer(){
  const ps=s.projects.filter(p=>!p.archived).sort((a,b)=>b.recent-a.recent||a.name.localeCompare(b.name));
  showDialog('Start a timer',ps.length?ps.map(p=>'<button class="list-row" data-action="quick" '+did(p.id)+'>'+tile(p,true)+'<span class="grow"><strong>'+h(p.name)+'</strong><small>'+h(projectInfo(p).c.name)+'</small></span>'+stateLabel(C.active(s,p.id))+'</button>').join(''):empty('projects','Create your first project','Each project has its own independent timer.','new-project','New project'));
}
function timeInput(at){
  const d=new Date(at);return time(at)+':'+String(d.getSeconds()).padStart(2,'0')+'.'+String(d.getMilliseconds()).padStart(3,'0');
}
function localStamp(at){return C.keyDate(at)+'T'+timeInput(at);}
function isLaterOccurrence(at) {
  return Number.isFinite(at) && C.clockValue(C.keyDate(at),timeInput(at)) < at;
}
function preserveStamp(value,old,later){
  if(old!==undefined&&old!==null&&Number.isFinite(old)&&Math.abs(+new Date(value)-+new Date(localStamp(old)))<1)return old;
  const [date,clock]=value.split('T');return C.clockValue(date,clock,later);
}
function entryForm(id='',prefer=''){
  const orig=C.byId(s.entries,id),timerEntry=orig?.kind==='timer';
  const projects=s.projects.filter(p=>!p.archived||p.id===orig?.projectId);
  if(!projects.length){showDialog('Add entry',empty('projects','Start with a project','Create a company and project for this work entry.','entry-project','Create project'));return;}
  const p=C.byId(projects,orig?.projectId??prefer)??projects[0],c=C.byId(s.companies,p.companyId);
  const finish=orig?.end??Math.floor(now()/C.MIN)*C.MIN,start=orig?.start??finish-C.HOUR;
  const breakMs=orig?C.lengthOf(orig.pauses):0;
  const timing=timerEntry?'<details class="timing"><summary>Recorded timeline · '+dur(C.lengthOf(orig.segments))+'</summary>'+hint('Adjust timestamps below. Recorded focus intervals must stay inside working segments.')+
    [...orig.segments.map(x=>[...x,'Work']),...orig.pauses.map(x=>[...x,'Pause'])].sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(([a,b,k],i)=>field(k+' starts',input('point'+i,localStamp(a),'datetime-local','required step="0.001"'))).join('')+
    field('Session ends',input('lastPoint',localStamp(finish),'datetime-local','required step="0.001"'))+'</details>':
    '<div class="form-grid">'+field('Start date',input('startDate',C.keyDate(start),'date','required'))+field('Start time',input('startTime',orig?timeInput(start):time(start),'time','step="0.001" required'))+
    field('Finish date',input('endDate',C.keyDate(finish),'date','required'))+field('Finish time',input('endTime',orig?timeInput(finish):time(finish),'time','step="0.001" required'))+
    field('Break (minutes)',input('breakMin',breakMs/C.MIN,'number','min="0" step="any"'))+field('Break starts at',input('breakAt',breakMs?timeInput(orig.pauses[0][0]):'','time','step="0.001"'))+field('Break date (optional)',input('breakDate',breakMs?C.keyDate(orig.pauses[0][0]):'','date'),true)+'</div>'+
    hint('An earlier finish time on the same date rolls into the next day. Leave the break start blank to place it at the end.');
  const rate=orig?{rate:orig.rate,currency:orig.currency}:C.rateAt(s,p,start),pay=s.payments.find(v=>v.entryId===id);
  const formHTML='<div class="form-grid">'+field('Company',select('company',s.companies.filter(c=>projects.some(p=>p.companyId===c.id)).map(v=>opt(v.id,v.name,c.id)).join(''),orig?'disabled':''))+
    field('Project',select('project',projects.filter(v=>v.companyId===c.id).map(v=>opt(v.id,v.name,p.id)).join(''),orig?'disabled':''))+'</div>'+timing+
    '<div class="duration-preview" id="net-preview"></div><details class="ambiguity"><summary>Daylight-saving time</summary>'+(timerEntry?checks('later','Use the later occurrence for changed repeated times'):checks('lateStart','Start in the later occurrence of a repeated hour',isLaterOccurrence(start))+checks('lateEnd','Finish in the later occurrence of a repeated hour',isLaterOccurrence(finish))+checks('lateBreak','Break in the later occurrence of a repeated hour',isLaterOccurrence(orig?.pauses[0]?.[0])))+'</details>'+
    field('Notes',textArea('notes',orig?.notes),true)+'<h3>Billing & reporting</h3>'+checks('billable','Billable work',orig?.billable)+checks('reviewed','Approve reportable duration',orig?.approved!=null)+
    '<div class="form-grid">'+field('Reportable minutes',input('approved',orig?.approved!=null?orig.approved/C.MIN:'','number','min="0" max="16666666" step="any" placeholder="Awaiting review"'))+
    field('Hourly rate (<span id="entry-cc">'+rate.currency+'</span>)',input('rate',amt(rate.rate),'number','min="0" max="100000000" step="0.01" placeholder="Not set"'))+
    field('Reporting status',select('status',options(C.statuses,orig?.status??'Unreported')))+field('Timesheet / invoice reference',input('reference',orig?.reference))+'</div>'+
    '<div id="payment-fields" class="form-grid">'+field('Confirmed payment ('+rate.currency+')',input('paid',amt(pay?.amount),'number','step="0.01" min="0" placeholder="Optional"'))+field('Payment date',input('paidDate',C.keyDate(pay?.at??now()),'date'))+'</div>'+
    '<div id="entry-overlap"></div>';
  function readTimes(form,st){
    const f=form.elements,late=f.later?.checked??false;
    if(timerEntry){
      const parts=[...orig.segments.map(x=>[...x,'segments']),...orig.pauses.map(x=>[...x,'pauses'])].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const points=parts.map((v,i)=>preserveStamp(f['point'+i].value,v[0],late));points.push(preserveStamp(f.lastPoint.value,orig.end,late));
      const next={...structuredClone(orig),start:points[0],end:points.at(-1),segments:[],pauses:[]};
      parts.forEach((v,i)=>{C.requireThat(points[i+1]>=points[i],'Timeline points must be in order.');next[v[2]].push([points[i],points[i+1]]);});
      return next;
    }
    const a=C.clockValue(f.startDate.value,f.startTime.value,f.lateStart.checked);
    let endDate=f.endDate.value;
    let b=C.clockValue(endDate,f.endTime.value,f.lateEnd.checked);
    if (b<a && endDate===f.startDate.value) {
      const next=C.localDate(endDate);
      next.setDate(next.getDate()+1);
      endDate=C.keyDate(next);
      b=C.clockValue(endDate,f.endTime.value,f.lateEnd.checked);
    }
    const br=Math.round(Number(f.breakMin.value)*C.MIN);
    let brAt=b-br;
    if (br && f.breakAt.value) {
      brAt=C.clockValue(f.breakDate.value || f.startDate.value,f.breakAt.value,f.lateBreak.checked);
      if (brAt<a && !f.breakDate.value) brAt=C.clockValue(endDate,f.breakAt.value,f.lateBreak.checked);
    }
    const project=f.project.value,model=C.manual(st,project,a,b,br,brAt,!!orig);
    if(orig){model.id=orig.id;model.revision=orig.revision;}
    return model;
  }
  function update(el,form){
    const f=form.elements;
    if(el?.name==='company')f.project.innerHTML=projects.filter(p=>p.companyId===f.company.value).map(p=>opt(p.id,p.name,'')).join('');
    f.approved.disabled=!f.reviewed.checked;f.approved.required=f.reviewed.checked;
    $('#payment-fields').hidden=f.status.value!=='Paid';
    try{
      const n=readTimes(form,s),raw=C.lengthOf(n.segments);
      if(!orig&&['company','project','startDate','startTime'].includes(el?.name)){f.rate.value=amt(n.rate);$('#entry-cc').textContent=n.currency;}
      $('#net-preview').textContent='Net working time · '+dur(raw);
      if(f.reviewed.checked&&!f.approved.value)f.approved.value=C.roundForReview(raw,s.settings.rounding)/C.MIN;
      const collision=C.overlaps({...s,entries:[...s.entries.filter(e=>e.id!==id),n]},[n.start,n.end],now()).has(n.id);
      const banner=$('#entry-overlap');if(collision&&!banner.firstChild)banner.innerHTML='<div class="warning">This entry overlaps other work. Review its reportable minutes before submitting or billing.</div>'+checks('ack','I reviewed the overlap and reportable time');
      if(!collision)banner.innerHTML='';
    }catch(err){$('#net-preview').textContent=err.message;}
  }
  showDialog(orig?'Edit work entry':'Add work entry',formHTML,async(d,form)=>{
    await write((st,at)=>{
      const existing=C.byId(st.entries,id);
      if(orig)C.requireThat(existing?.revision===orig.revision,'This entry changed. Reopen it before saving.');
      const n=readTimes(form,st),rate=orig?orig.currency:n.currency;
      Object.assign(n,{currency:rate,rate:decimal(d.rate),billable:!!d.billable,approved:d.reviewed?Math.round(Number(d.approved)*C.MIN):null,
        notes:d.notes,reference:d.reference,status:d.status,revision:(orig?.revision??0)+1});
      C.requireThat(n.status==='Unreported'||n.approved!==null,'Approve a reportable duration before changing reporting status.');
      C.recordAdjustment(st,n.id,existing?.approved??null,n.approved,at);
      const idx=st.entries.findIndex(e=>e.id===id);if(idx>=0)st.entries[idx]=n;else st.entries.push(n);
      if(n.approved!==null&&C.overlaps(st,[n.start,n.end],at).has(n.id))C.requireThat(d.ack,'Confirm that you reviewed the overlapping time.');
      const previous=st.payments.find(v=>v.entryId===n.id);
      if(previous&&(n.status!=='Paid'||d.paid===''))C.requireThat(confirm('Remove the confirmed payment record for this entry?'),'Payment change cancelled.');
      st.payments=st.payments.filter(v=>v.entryId!==n.id);
      if(n.status==='Paid'&&d.paid!==''){st.payments.push({id:previous?.id??C.uid(),entryId:n.id,amount:decimal(d.paid,false),currency:n.currency,at:+C.localDate(d.paidDate)});}
    },orig?'Edit entry':'Create entry',id);
    closeDialog();toast('Work entry saved');
  },orig?'Save entry':'Add entry',orig?button('delete-entry','Delete','','danger',did(id)+' data-revision="'+orig.revision+'"'):'',update);
  update(null,$('#editform'));
}
function goalForm(){
  const initial=s.settings.period;
  showDialog('Personal goals','<div class="form-grid">'+field('Period',select('period',C.periods.map(p=>opt(p,cap(p),initial)).join('')))+field('Date in period',input('goalDate',C.keyDate(now()),'date','required'))+
    field('Apply to',select('scope',opt('overrides','Only this period','overrides')+opt('defaults','Recurring default from this period','overrides')),true)+
    field('Hours target',input('hours','','number','step="any" min="0.0001" placeholder="No target"'))+field('Earnings target ('+s.settings.currency+')',input('money','','number','step="0.01" min="0.01" placeholder="No target"'))+'</div>'+
    '<p class="hint" id="goal-source"></p>'+hint('Leave either target blank to clear it. Earlier periods keep their targets.')+hint('Hours use '+bases[s.settings.basis].toLowerCase()+'. Earnings use approved billable work in every currency, converted to '+s.settings.currency+'.'),
    async d=>{await write(st=>{C.saveGoal(st,d.period,+C.localDate(d.goalDate),d.hours?Number(d.hours):null,decimal(d.money),d.scope);},'Update goal');closeDialog();toast('Goals saved');},'Save goals','',(el,form)=>{if(['period','goalDate','scope'].includes(el.name))load(form);});
  function load(form){
    const f=form.elements;if(!f.goalDate.value)return;const at=+C.localDate(f.goalDate.value),key=C.keyDate(C.periodRange(f.period.value,at,s.settings.weekStart)[0]);
    const g=C.goal(f.scope.value==='defaults'?{...s,overrides:[]}:s,f.period.value,at);
    f.hours.value=g.hours??'';f.money.value=amt(g.money);$('#goal-source').textContent='Period beginning '+dateLabel(+C.localDate(key))+' · '+(g.id?(s.overrides.some(x=>x.id===g.id)?'Specific-period override':'Recurring default'):'No targets configured');
  }load($('#editform'));
}
function settingsForm(){
  const p=s.settings;
  showDialog('Settings','<div class="form-grid">'+field('Appearance',select('theme',['system','light','dark'].map(v=>opt(v,cap(v),p.theme)).join('')))+field('Goal currency',select('currency',options(C.currencies,p.currency)))+
    field('Hours calculation basis',select('basis',Object.entries(bases).map(([v,n])=>opt(v,n,p.basis)).join('')),true)+field('Week begins',select('weekStart',['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((v,i)=>opt(i,v,p.weekStart)).join('')))+
    field('Sound effects',select('sound',opt('on','On',p.sound?'on':'off')+opt('off','Off',p.sound?'on':'off')))+field('Streak counts days when',select('streak',opt('worked','I work 30+ minutes',p.streak)+opt('goal','I hit my daily goal',p.streak)))+
    '<div class="field wide">'+checks('restWeekends','Weekends without work don’t break a streak',p.restWeekends)+'</div>'+
    field('Reportable suggestion',select('rounding',[1,5,6,10,15,30].map(v=>opt(v,'Nearest '+v+' min',p.rounding)).join('')))+'</div>'+hint('Rounding applies when you first approve reportable minutes. Raw timers retain their exact timestamps.')+
    '<h3>On this device</h3><div class="settings-links">'+(example?'':button('account',sync?.account?'GitHub sync · '+sync.account.repo:'GitHub sync','user','menu-action'))+button('rates','Exchange rates','money','menu-action')+button('goals','Personal goals','target','menu-action')+button('backup','Backup & restore','backup','menu-action')+button('workspace',example?'Example workspace':'Personal workspace','switch','menu-action')+'</div><p class="hint" id="offline-state">'+h(swReady?'App files cached for offline use.':swIssue||'Preparing offline app files…')+'</p>',
    async d=>{await write(st=>{Object.assign(st.settings,{sound:d.sound==='on',streak:d.streak,restWeekends:!!d.restWeekends,theme:d.theme,currency:d.currency,basis:d.basis,weekStart:Number(d.weekStart),rounding:Number(d.rounding)});},'Update settings');closeDialog();toast('Settings saved');},'Save settings');
}
function backupForm(){
  backupPending=null;
  showDialog('Backup & restore','<p class="intro">Keep a copy of your ledger outside this device.</p><div class="backup-info"><strong>Last backup download</strong><small>'+(s.settings.backupAt?dateLabel(s.settings.backupAt)+' · '+time(s.settings.backupAt):'No backup downloaded yet')+'</small></div>'+button('backup-save','Download JSON backup','download','primary')+
    '<h3>Restore a backup</h3>'+field('TimeLedger JSON file','<input type="file" name="backupFile" accept=".json,application/json">')+'<div id="backup-options"></div>'+
    hint('A backup includes open timers, focus, entries, rates, goals and payments. Clearing site data or deleting the app can remove your records. Keep regular copies.'),
    null,'','',async(el)=>{if(el.name!=='backupFile')return;try{backupPending=null;$('#backup-options').innerHTML='';const file=el.files[0];if(!file)return;const parsed=C.decodeBackup(await file.text());backupPending=parsed;$('#backup-options').innerHTML='<div class="warning">'+parsed.entries.length+' entries · '+parsed.projects.length+' projects · '+parsed.companies.length+' companies</div>'+hint('Merge adds missing records and keeps local settings. Conflicting records stop the merge. Replace uses the entire backup.')+'<div class="toolbar">'+button('restore-merge','Merge records','','secondary')+button('restore-replace','Replace all data','','danger')+'</div>';$('#form-error').textContent='';}catch(err){errorMessage(err);}});
}
function ratesForm(){
  const fx=s.settings.fx,cc=s.settings.currency,others=C.currencies.filter(c=>c!==cc);
  const rate=c=>(fx.rates[c]/fx.rates[cc]).toPrecision(6).replace(/\.?0+$/,'');
  showDialog('Exchange rates','<p class="intro">Earnings in other currencies are converted to your goal currency, '+cc+', for totals and goals. Each entry keeps its original currency.</p><div class="form-grid">'+
    others.map(c=>field('1 '+cc+' in '+c,input('fx-'+c,rate(c),'number','step="any" min="0.000001" required'))).join('')+'</div>'+
    '<p class="hint">'+h(fx.source==='ECB'?'European Central Bank reference rates, '+dateLabel(fx.at)+'.':fx.source==='manual'?'Entered manually'+(fx.at?' on '+dateLabel(fx.at):'')+'.':'Approximate built-in rates. Connect to the internet to load current rates.')+'</p>'+
    button('rates-fetch','Load current rates','download','secondary')+hint('Saving your own rates stops automatic updates until you load current rates again.'),
    async d=>{await write(st=>{
      const base=st.settings.fx.rates[cc],rates={...st.settings.fx.rates};
      for(const c of others){const v=Number(d['fx-'+c]);C.requireThat(v>0&&Number.isFinite(v),'Enter a positive rate for '+c+'.');rates[c]=v*base;}
      st.settings.fx={rates,at:Date.now(),source:'manual'};
    },'Update exchange rates');closeDialog();toast('Exchange rates saved');},'Save rates');
}
async function updateRates(force=false){
  const fx=s.settings.fx;
  if(!navigator.onLine||(!force&&(fx.source==='manual'||(fx.at&&Date.now()-fx.at<12*C.HOUR))))return;
  try{
    const res=await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols='+C.currencies.filter(c=>c!=='EUR').join(','));
    const data=await res.json();C.requireThat(res.ok&&data.rates,'Unable to load exchange rates.');
    const at=+new Date(data.date+'T16:00:00Z');
    await write(st=>{st.settings.fx={rates:{...st.settings.fx.rates,...data.rates,EUR:1},at:Number.isSafeInteger(at)?at:Date.now(),source:'ECB'};});
    if(force)toast('Exchange rates updated');
  }catch(err){if(force)throw new Error('Unable to load exchange rates. Check your connection and try again.');}
}
function accountForm(){
  signInPending=null;
  const a=sync.account,st=sync.status;
  if(a)return showDialog('GitHub sync','<p class="intro">This device keeps your ledger in a private GitHub repository as a readable JSON file.</p><div class="backup-info"><strong>'+h(a.user)+'</strong><small><a href="https://github.com/'+h(a.repo)+'/blob/HEAD/'+h(a.path)+'" target="_blank" rel="noopener">'+h(a.repo+' / '+a.path)+'</a></small><small id="sync-status">'+h(statusText())+'</small></div><div class="toolbar">'+button('sync-now','Sync now','switch','primary')+button('sign-out','Sign out','','secondary')+'</div>'+hint('Changes sync automatically when you are online. If two devices change the same record, the most recent revision is kept. Signing out removes the token from this device; your records stay here and in the repository.'));
  showDialog('GitHub sync','<p class="intro">Keep your ledger in a <b>private</b> GitHub repository so every device you sign in on shares it.</p><div class="form-grid">'+
    field('Private repository',input('repo',syncRepo,'text','placeholder="you/timeledger-data" autocapitalize="none" autocorrect="off" spellcheck="false" required'),true)+
    field('Personal access token',input('token','','password','autocomplete="off" spellcheck="false" required placeholder="github_pat_…"'),true)+
    field('File in the repository',input('path','timeledger.json','text','autocapitalize="none" spellcheck="false" required'),true)+'</div>'+
    (st.error?'<div class="warning">'+h(st.error)+'</div>':'')+
    '<details class="howto"><summary>How to set this up</summary><ol><li>On GitHub, create a new <b>private</b> repository, for example <code>timeledger-data</code>.</li><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens</a>. Choose <b>Only select repositories</b> and pick that repository.</li><li>Under Repository permissions, set <b>Contents</b> to <b>Read and write</b>. Generate the token and paste it here.</li><li>Use the same repository and token on each device.</li></ol></details>'+
    hint('The token is stored only on this device. If the repository already holds a ledger, you can merge it with this device’s records or replace them.'),
    async()=>signIn(),'Sign in');
}
function statusText(){const st=sync.status;return st.state==='synced'?'Last synced '+time(st.at):st.state==='syncing'?'Syncing…':st.state==='offline'?'Offline · changes will sync when you reconnect':st.state==='error'?'Sync problem: '+st.error:'Waiting to sync';}
async function signIn(){
  const f=$('#editform').elements;
  if(!f.repo.value||!f.token.value)throw new Error('Enter the repository and a personal access token.');
  const submit=$('#editform [type=submit]');if(submit)submit.textContent='Connecting…';
  try{
    const r=await sync.signIn({repo:f.repo.value,token:f.token.value,path:f.path.value});
    if(r.choice==='ask'){
      signInPending=r;
      return showDialog('Merge or replace?','<p class="intro">The repository already has a ledger, and so does this device.</p><div class="warning">Repository: '+r.counts.entries+' entries · '+r.counts.projects+' projects · '+r.counts.companies+' companies<br>This device: '+s.entries.length+' entries · '+s.projects.length+' projects · '+s.companies.length+' companies</div>'+
        hint('Merge keeps the records from both. Replace discards this device’s records and uses the repository copy. Download a backup first if you are unsure.')+
        '<div class="settings-links">'+button('login-merge','Merge both','layers','menu-action')+button('login-replace','Replace this device with the repository','download','menu-action')+button('login-upload','Replace the repository with this device','backup','menu-action')+button('login-cancel','Cancel','close','menu-action')+'</div>');
    }
    await sync.finishSignIn(r.choice==='download'?'replace':'upload',r.remote,r.remoteVersion);await refresh();closeDialog();
    toast('Connected to GitHub and synced');
  }finally{if(submit?.isConnected)submit.textContent='Sign in';}
}
// ---- Game layer: player card, live earnings, Goals page, celebrations ----
const short=v=>money(v,undefined,true);
const int=n=>Math.round(n).toLocaleString('en-GB');
const gameState=()=>G.play(s,now(),short);
function levelChip(cls){
  const g=gameState();
  return '<button class="'+cls+'" data-action="nav" data-page="Goals" aria-label="Level '+g.level+', '+g.streak.current+' day streak"><span class="lvl-dot">'+g.level+'</span><span>'+h(g.rank)+'</span>'+(g.streak.current?'<span class="chip-streak">🔥'+g.streak.current+'</span>':'')+'</button>';
}
function todayEarned(){
  const r=C.periodRange('day',now()),by={};
  for(const e of s.entries)if(e.start<r[1]&&(e.end??Infinity)>r[0]){const a=C.entryStats(e,r,now());by[e.currency]=(by[e.currency]??0)+G.earned(e,a);}
  return C.totalIn(by,s.settings.currency,s.settings.fx);
}
function playerCard(big=false){
  const g=gameState(),span=g.next-g.floor,into=g.xp-g.floor,pct=Math.min(100,100*into/span),running=s.entries.some(e=>e.end===null&&C.conditionOf(e)==='Running'&&e.rate!==null);
  return '<section class="player'+(big?' big':'')+'"><button class="lvl" data-action="nav" data-page="Goals" aria-label="Level '+g.level+'"><small>LEVEL</small><b>'+g.level+'</b></button>'+
    '<div class="player-main"><div class="player-top"><strong>'+h(g.rank)+'</strong><span>'+int(into)+' / '+int(span)+' XP</span></div><div class="xp-track"><i style="--w:'+pct+'%"></i></div>'+
    (big?'<small class="xp-total">'+int(g.xp)+' XP in total · '+int(g.next-g.xp)+' XP to level '+(g.level+1)+'</small>':'')+'</div>'+
    '<div class="streak'+(g.streak.current?' on':'')+(g.streak.todayDone?' done':'')+'" title="Best streak: '+g.streak.best+' days"><span class="flame">🔥</span><span><b>'+g.streak.current+'</b><small>day streak'+(big?' · best '+g.streak.best:'')+'</small></span></div>'+
    '<div class="live'+(running?' on':'')+'"><small>'+(running?'<i class="rec"></i>Earning now':'Earned today')+'</small><b data-live-total>'+money(todayEarned())+'</b></div>'+
    ib('mute',s.settings.sound?'Mute sounds':'Turn sounds on',s.settings.sound?'sound':'mute','','icon-btn mute')+'</section>';
}
let coinBucket=null,heatMode='hours';
function liveTick(){
  const total=$('[data-live-total]'),lv=G.live(s,now());
  for(const el of $$('[data-live]')){const e=C.byId(s.entries,el.dataset.live);if(e)el.textContent='+'+money(lv.per[e.id]??0,e.currency);}
  if(!total)return;
  const v=todayEarned();total.textContent=money(v);
  const step=1000,bucket=Math.floor(v/step),running=Object.keys(lv.per).length&&s.entries.some(e=>e.end===null&&C.conditionOf(e)==='Running');
  if(coinBucket!==null&&bucket===coinBucket+1&&running){sfx('coin');floatText(total,'+'+short(step));}
  coinBucket=bucket;
}
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function floatText(el,text){
  if(reduced())return;const r=el.getBoundingClientRect(),f=document.createElement('span');
  f.className='float-coin';f.textContent='🪙 '+text;f.style.left=(r.left+r.width/2)+'px';f.style.top=r.top+'px';
  document.body.append(f);setTimeout(()=>f.remove(),1400);
}
function confetti(n=110){
  if(reduced())return;
  const box=document.createElement('div'),colors=['#7c5cff','#ff7a59','#ffc53d','#22c3a6','#4aa8ff','#ff5fa2'];box.className='confetti';
  box.innerHTML=Array.from({length:n},()=>'<i style="--x:'+(Math.random()*100)+'vw;--dx:'+(Math.random()*30-15)+'vw;--r:'+(Math.random()*900-450)+'deg;--d:'+(1.6+Math.random()*1.6)+'s;--delay:'+(Math.random()*.35)+'s;--c:'+colors[Math.floor(Math.random()*colors.length)]+';--s:'+(6+Math.random()*7)+'px"></i>').join('');
  document.body.append(box);setTimeout(()=>box.remove(),3800);
}
// Animate numbers that changed since the last render.
const counted=new Map();
function countUp(){
  if(reduced())return;
  for(const el of $$('[data-count]')){
    const key=el.dataset.key,to=Number(el.dataset.count),from=counted.get(key)??(el.dataset.from?Number(el.dataset.from):to);counted.set(key,to);
    if(from===to)continue;const fmt=el.dataset.fmt==='money'?v=>money(Math.round(v)):el.dataset.fmt==='dur'?dur:int,t0=performance.now();
    el.classList.add('bump');
    const step=t=>{const k=Math.min(1,(t-t0)/900),e=1-Math.pow(1-k,3);el.textContent=fmt(from+(to-from)*e);if(k<1)requestAnimationFrame(step);else el.classList.remove('bump');};
    requestAnimationFrame(step);
  }
}
// Celebrate goals, achievements and level-ups once per device.
const celebrations=[];let celebrating=false;
const seenKey=()=>'timeledger-game-'+(example?'example':'personal');
function checkCelebrations(){
  if(!s)return;
  const g=gameState(),hits={};
  for(const p of C.periods){const r=G.goalResult(s,g.days,p,now());if(r?.hit)hits[p]=p+':'+C.keyDate(r.range[0]);}
  const unlocked=g.achievements.filter(a=>a.unlocked).map(a=>a.id);
  let seen=null;try{seen=JSON.parse(localStorage.getItem(seenKey()));}catch{}
  const next={level:g.level,achievements:unlocked,goals:Object.values(hits)};
  if(seen){
    for(const p of C.periods)if(hits[p]&&!seen.goals.includes(hits[p]))celebrations.push({sound:'goal',icon:'🎯',title:({day:'Daily',week:'Weekly',month:'Monthly',year:'Yearly'})[p]+' goal reached!',text:'+'+G.goalXp[p]+' XP · '+({day:'Great day’s work.',week:'What a week.',month:'A month to be proud of.',year:'An entire year — legendary.'})[p]});
    for(const a of g.achievements)if(a.unlocked&&!seen.achievements.includes(a.id))celebrations.push({sound:'achievement',icon:a.icon,title:'Achievement unlocked',sub:a.name,text:a.desc+' · +100 XP'});
    if(g.level>seen.level)celebrations.push({sound:'level',icon:'⭐',title:'Level '+g.level+'!',sub:g.rank,text:'Keep going — level '+(g.level+1)+' is '+int(g.next-g.xp)+' XP away.',big:true});
    next.level=Math.max(seen.level,g.level);next.achievements=[...new Set([...seen.achievements,...unlocked])];next.goals=[...new Set([...seen.goals,...next.goals])].slice(-60);
  }
  try{localStorage.setItem(seenKey(),JSON.stringify(next));}catch{}
  runCelebrations();
}
function runCelebrations(){
  if(celebrating||sheet.open||!celebrations.length)return;
  const c=celebrations.shift();celebrating=true;
  const el=document.createElement('div');el.className='celebrate'+(c.big?' big':'');el.setAttribute('role','status');
  el.innerHTML='<div class="celebrate-card"><div class="celebrate-icon">'+c.icon+'</div><strong>'+h(c.title)+'</strong>'+(c.sub?'<em>'+h(c.sub)+'</em>':'')+'<p>'+h(c.text)+'</p></div>';
  document.body.append(el);sfx(c.sound);confetti(c.big?180:110);
  const done=()=>{if(!el.isConnected)return;el.classList.add('out');setTimeout(()=>{el.remove();celebrating=false;runCelebrations();},300);};
  el.addEventListener('click',done);setTimeout(done,c.big?4200:3200);
}
function ring(ratio,cls,label,value,goalText){
  const pct=ratio===null?0:Math.min(1,ratio),C2=2*Math.PI*42;
  return '<div class="ring '+cls+(ratio>=1?' hit':'')+'"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="42"/><circle class="ring-fg" cx="50" cy="50" r="42" style="--full:'+C2+';--off:'+(C2*(1-pct))+'"/></svg><div class="ring-in"><b>'+(ratio===null?'—':Math.round(ratio*100)+'%')+'</b><small>'+label+'</small></div><div class="ring-value">'+value+'</div><small class="ring-goal">'+goalText+'</small></div>';
}
function periodCard(g,p){
  const at=now(),r=C.periodRange(p,at,s.settings.weekStart),gl=C.goal(s,p,at),t=G.totals(s,g.days,r),hours=t[s.settings.basis],earn=t.moneyTotal;
  const th=gl.hours?gl.hours*C.HOUR:null,res=G.goalResult(s,g.days,p,at);
  const title={day:'Today',week:'This week',month:'This month',year:'This year'}[p];
  const when=p==='day'?dateLabel(r[0],{weekday:'short',day:'numeric',month:'short'}):dateLabel(r[0],{day:'numeric',month:'short'})+' – '+dateLabel(r[1]-1,{day:'numeric',month:'short'});
  const paceLine=(actual,target,fmt)=>{if(p==='day'||!target)return '';const pc=G.pace(s,p,at,actual,target);return '<li>'+(pc.forecast!==null?'On pace for <b>'+fmt(pc.forecast)+'</b> ('+Math.round(100*pc.forecast/target)+'%)':'Pace appears once you start')+(actual<target&&pc.perDay!==null?' · '+fmt(pc.perDay)+' per work day to go':'')+'</li>';};
  const pace=paceLine(hours,th,dur)+paceLine(earn,gl.money,short);
  return '<article class="goal-card'+(res?.hit?' hit':'')+'"><header><div><h3>'+title+'</h3><small>'+h(when)+'</small></div>'+(res?.hit?'<span class="goal-hit">🏆 Goal hit · +'+G.goalXp[p]+' XP</span>':'')+'</header>'+
    '<div class="rings">'+ring(th?hours/th:null,'hours','hours','<span data-count="'+hours+'" data-key="g-h-'+p+'" data-fmt="dur" data-from="0">'+dur(hours)+'</span>',th?'of '+dur(th):'No target')+ring(gl.money?earn/gl.money:null,'money','earned','<span data-count="'+earn+'" data-key="g-m-'+p+'" data-fmt="money" data-from="0">'+money(earn)+'</span>',gl.money?'of '+short(gl.money):'No target')+'</div>'+
    (pace?'<ul class="pace">'+pace+'</ul>':'')+
    '<form class="goal-inline" data-period="'+p+'"><label><span>Hours</span><input name="hours" type="number" step="any" min="0.0001" value="'+h(gl.hours??'')+'" placeholder="—"></label><label><span>'+s.settings.currency+'</span><input name="money" type="number" step="0.01" min="0.01" value="'+h(amt(gl.money))+'" placeholder="—"></label>'+
    '<label class="scope"><span>Applies to</span><select name="scope"><option value="defaults">Every '+p+' from now</option><option value="overrides">'+title+' only</option></select></label><button class="primary compact" type="submit">Save</button></form></article>';
}
function targetsSection(){
  const owner=t=>t.kind==='company'?C.byId(s.companies,t.owner):C.byId(s.projects,t.owner);
  const rows=s.targets.map(t=>{
    const pr=G.targetProgress(s,t,now()),o=owner(t),color=t.kind==='company'?o.color:C.byId(s.companies,o.companyId).color;
    const bar=(v,target,fmt,cls)=>target?'<div class="t-bar '+cls+(v>=target?' hit':'')+'"><div class="t-label"><span>'+fmt(v)+' of '+fmt(target)+'</span><b>'+Math.round(100*v/target)+'%</b></div><div class="t-track"><i style="--w:'+Math.min(100,100*v/target)+'%"></i></div></div>':'';
    return '<button class="target-row" data-action="target" '+did(t.id)+'><span class="company-dot" style="background:'+color+'"></span><span class="grow"><strong>'+h(o.name)+'</strong><small>'+cap(t.kind)+' · per '+t.period+'</small>'+bar(pr.hours,t.hours&&t.hours*C.HOUR,dur,'hours')+bar(pr.money,t.money,v=>money(v,pr.currency,true),'money')+'</span>'+icon('edit',16)+'</button>';
  }).join('');
  return '<section>'+section('Client & project targets',s.targets.length||null,s.companies.length?button('new-target','Add target','plus','secondary compact'):'')+'<div class="card">'+(rows||empty('building','No client targets yet','Set hours or earnings targets for a company or a single project.'))+'</div></section>';
}
function targetForm(id=''){
  const t=C.byId(s.targets,id);
  const choices=s.companies.map(c=>opt('company:'+c.id,'Company · '+c.name+' ('+c.currency+')',t&&t.kind+':'+t.owner))+s.projects.filter(p=>!p.archived||t?.owner===p.id).map(p=>opt('project:'+p.id,'Project · '+p.name+' ('+C.byId(s.companies,p.companyId).currency+')',t&&t.kind+':'+t.owner)).join('');
  showDialog(t?'Edit target':'New target','<div class="form-grid">'+field('Target for',select('who',choices,'required'),true)+field('Period',select('period',C.periods.map(p=>opt(p,'Per '+p,t?.period??'month')).join('')))+field('Hours',input('hours',t?.hours??'','number','step="any" min="0.0001" placeholder="Optional"'))+field('Earnings (client currency)',input('money',amt(t?.money),'number','step="0.01" min="0.01" placeholder="Optional"'),true)+'</div>'+hint('Earnings include unreviewed work at its recorded rate.'),
    async d=>{
      const [kind,owner]=d.who.split(':'),hours=d.hours?Number(d.hours):null,m=decimal(d.money);
      C.requireThat(hours!==null||m!==null,'Set an hours or earnings target.');C.requireThat(hours===null||hours>0,'Enter a positive number of hours.');
      await write(st=>{const rec={id:t?.id??C.uid(),kind,owner,period:d.period,hours,money:m};const i=st.targets.findIndex(x=>x.id===rec.id);if(i>=0)st.targets[i]=rec;else st.targets.push(rec);},t?'Edit target':'Create target');
      sfx('save');closeDialog();toast('Target saved');
    },t?'Save target':'Add target',t?button('delete-target','Delete','','danger',did(t.id)):'');
}
function heatmapSection(g){
  const weeks=26,end=C.periodRange('week',now(),s.settings.weekStart)[1],start=new Date(end);start.setDate(start.getDate()-weeks*7);
  const cells=[],values=[],today=C.keyDate(now());
  for(const d=new Date(start);+d<end;d.setDate(d.getDate()+1)){
    const key=C.keyDate(d),day=g.days.get(key),v=!day?0:heatMode==='hours'?day.unique:C.totalIn(day.earned,s.settings.currency,s.settings.fx);
    cells.push({key,v,future:key>today,first:d.getDate()===1});values.push(v);
  }
  const max=Math.max(...values,1);
  const level=v=>!v?0:v<=max*.25?1:v<=max*.5?2:v<=max*.75?3:4;
  const months=[];for(let w=0;w<weeks;w++){const c=cells.slice(w*7,w*7+7).find(c=>c.first);months.push(c?dateLabel(+C.localDate(c.key),{month:'short'}):'');}
  const total=values.reduce((a,b)=>a+b,0);
  return '<section>'+section('Activity',null,'<div class="tabs small">'+['hours','earnings'].map(m=>'<button data-action="heat-mode" data-value="'+m+'" aria-pressed="'+(heatMode===m)+'">'+cap(m)+'</button>').join('')+'</div>')+
    '<div class="card heat-card"><div class="heat-scroll"><div class="heat-months">'+months.map(m=>'<span>'+m+'</span>').join('')+'</div><div class="heatmap" role="img" aria-label="Activity over the last 26 weeks">'+
    cells.map(c=>'<i class="l'+level(c.v)+(c.future?' future':'')+(c.key===today?' today':'')+'" title="'+h(dateLabel(+C.localDate(c.key))+' · '+(heatMode==='hours'?dur(c.v):money(c.v)))+'"></i>').join('')+'</div></div>'+
    '<div class="heat-foot"><span>'+(heatMode==='hours'?dur(total)+' worked':money(total)+' earned')+' in 26 weeks</span><span class="heat-legend">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</span></div></div></section>';
}
function historySection(g){
  const chips=(period,count)=>{
    const out=[];const d=new Date(C.periodRange(period,now(),s.settings.weekStart)[0]);
    for(let i=0;i<count;i++){
      const at=+d,r=G.goalResult(s,g.days,period,at),label=period==='week'?dateLabel(at,{day:'numeric',month:'short'}):dateLabel(at,{month:'short',year:'2-digit'});
      out.unshift('<div class="hist '+(!r?'none':r.hit?'hit':'miss')+(i===0?' now':'')+'"><b>'+(!r?'—':r.hit?'🏆':r.percent+'%')+'</b><small>'+(i===0?'Now':h(label))+'</small></div>');
      if(period==='week')d.setDate(d.getDate()-7);else d.setMonth(d.getMonth()-1);
    }
    return '<div class="hist-row">'+out.join('')+'</div>';
  };
  return '<section>'+section('Goal history',null)+'<div class="card hist-card"><h3>Weeks</h3>'+chips('week',8)+'<h3>Months</h3>'+chips('month',6)+'</div></section>';
}
function achievementsSection(g){
  const got=g.achievements.filter(a=>a.unlocked).length;
  return '<section>'+section('Achievements',got+'/'+g.achievements.length)+'<div class="badges">'+g.achievements.map(a=>'<div class="badge-card'+(a.unlocked?' got':'')+'"><span class="badge-icon">'+(a.unlocked?a.icon:'🔒')+'</span><strong>'+h(a.name)+'</strong><small>'+h(a.desc)+'</small></div>').join('')+'</div></section>';
}
function goalsPage(){
  const g=gameState();
  return playerCard(true)+'<section>'+section('Goals at a glance',null,button('goal-advanced','Plan another period','sliders','text-btn'))+'<div class="goal-grid">'+C.periods.map(p=>periodCard(g,p)).join('')+'</div>'+
    hint('Hours use '+bases[s.settings.basis].toLowerCase()+'. Earnings use approved billable work in every currency, converted to '+s.settings.currency+'. XP, streaks and the live counter also count unreviewed work at its rate.')+'</section>'+
    targetsSection()+heatmapSection(g)+historySection(g)+achievementsSection(g);
}
document.addEventListener('submit',async e=>{
  const f=e.target.closest('.goal-inline');if(!f)return;e.preventDefault();if(busy)return;busy=true;
  try{
    const d=Object.fromEntries(new FormData(f)),hours=d.hours?Number(d.hours):null;
    C.requireThat(hours===null||hours>0,'Enter a positive number of hours.');
    await write(st=>{C.saveGoal(st,f.dataset.period,now(),hours,decimal(d.money),d.scope);},'Update goal');sfx('save');toast(cap(f.dataset.period)+' goal saved');
  }catch(err){errorMessage(err);}finally{busy=false;}
});
soundSetting(()=>!!s?.settings.sound);
function downloadFile(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function workspaceForm(){
  showDialog('Workspace','<p class="intro">'+(example?'You are exploring sample projects in a separate ledger.':'Your personal ledger is stored on this device.')+'</p>'+button(example?'personal':'example',example?'Open personal workspace':'Explore example workspace','switch','menu-action')+hint(example?'Your personal workspace starts empty.':'The example workspace has its own data and timers.'));
}
function prepareExport(type){
  const range=rangeFor(),entries=filtered(range),hits=C.overlaps(s,range,now());
  const overlapping=entries.filter(e=>hits.has(e.id));
  exportPending={type,range,ids:entries.map(e=>e.id),revs:entries.map(e=>e.revision)};
  if(!overlapping.length)return finishExport();
  const html=hint('These entries share clock time with other work, including projects outside the filters. Confirm the minutes to include for each entire session. The export allocates them to the selected dates.')+
    overlapping.map(e=>field(h(C.byId(s.projects,e.projectId).name)+' · '+h(dateLabel(e.start))+' '+time(e.start)+' · '+dur(C.lengthOf(e.segments))+' logged',input('review-'+e.id,e.approved===null?'':e.approved/C.MIN,'number','min="0" step="any" required placeholder="Reportable minutes, including 0"'),true)).join('')+checks('ack','I have reviewed these overlapping sessions');
  showDialog('Review overlapping time',html,async d=>{C.requireThat(d.ack,'Confirm the overlap review to continue.');await finishExport(d);},'Confirm & '+(type==='CSV'?'export':'print'));
}
async function finishExport(d=null){
  const pending=exportPending, {type,range,ids,revs}=pending;
  await write((st,at)=>{
    const current=st.entries.filter(e=>ids.includes(e.id));
    C.requireThat(current.length===ids.length&&ids.every((id,i)=>C.byId(current,id).revision===revs[i]),'Entries changed. Close and generate the report again.');
    const hits=C.overlaps(st,range,at);
    for(const e of current)if(hits.has(e.id)){
      C.requireThat(d&&Object.hasOwn(d,'review-'+e.id),'An overlap changed. Generate the report again.');
      const approved=Math.round(Number(d['review-'+e.id])*C.MIN);if(approved!==e.approved){C.recordAdjustment(st,e.id,e.approved,approved,at);e.approved=approved;e.revision++;}
    }
    st.batches.push({id:C.uid(),type,at,range,entryIds:ids,records:current.map(e=>{
      const a=C.entryStats(e,range,at);
      return {entryId:e.id,revision:e.revision,project:C.byId(st.projects,e.projectId).name,company:C.byId(st.companies,e.companyId).name,
        logged:a.logged,approved:a.approved,rate:e.rate,currency:e.currency,estimated:a.incomplete?null:a.amount,status:e.status,reference:e.reference};
    })});
  },'Prepare '+type+' report');
  closeDialog();const entries=ids.map(id=>C.byId(s.entries,id));
  if(type==='CSV'){downloadFile(C.csv(s,entries,range,now()),'text/csv;charset=utf-8','TimeLedger-'+C.keyDate(range[0])+'-'+C.keyDate(range[1]-1)+'.csv');toast('CSV exported');}
  else{const a=C.summary(entries,range,now());$('#printout').innerHTML='<h1>TimeLedger</h1><h2>Timesheet</h2><p>'+dateLabel(range[0])+' – '+dateLabel(range[1]-1)+'</p><p>Logged '+dur(a.logged)+' · Unique '+dur(a.unique)+' · Overlap '+dur(a.overlap)+' · Reviewed '+dur(a.approved)+'</p><p>Estimated payable '+h(allAmounts(a.money,a.incomplete))+(Object.keys(a.money).length>1?' · ≈ '+h(money(combined(a.money)))+' total':'')+'</p>'+reportRows(entries,range,true)+grouped(entries,range);window.print();}
  exportPending=null;
}
async function action(name,el){
  const id=el.dataset.id,p=C.byId(s.projects,id),value=el.dataset.value;
  switch(name){
    case 'nav':return setView(el.dataset.page);
    case 'today-sheet':filter={...initFilter(),period:'day'};return setView('Timesheet');
    case 'close':return closeDialog();
    case 'workspace':return workspaceForm();
    case 'personal':case 'example':{const u=new URL(location.href);u.search=name==='example'?'?example=1':'';u.hash='today';location.assign(u);return;}
    case 'settings':return settingsForm();
    case 'goals':return setView('Goals');
    case 'goal-advanced':return goalForm();
    case 'mute':await write(st=>{st.settings.sound=!st.settings.sound;});if(s.settings.sound)sfx('save');return toast(s.settings.sound?'Sounds on':'Sounds muted');
    case 'heat-mode':heatMode=value;return render();
    case 'target':return targetForm(id);
    case 'new-target':return targetForm();
    case 'delete-target':if(!confirm('Delete this target?'))return;await write(st=>{st.targets=st.targets.filter(t=>t.id!==id);},'Delete target',id);closeDialog();return toast('Target deleted');
    case 'backup':return backupForm();
    case 'rates':return ratesForm();
    case 'rates-fetch':await updateRates(true);return ratesForm();
    case 'account':return accountForm();
    case 'sign-in':return signIn();
    case 'login-merge':case 'login-replace':case 'login-upload':{
      const p=signInPending;C.requireThat(p,'Sign in again.');
      const mode=name.slice(6);
      if(mode==='replace'&&!confirm('Replace every record on this device with the repository copy?'))return;
      if(mode==='upload'&&!confirm('Replace the repository copy with the records on this device?'))return;
      await sync.finishSignIn(mode,p.remote,p.remoteVersion);signInPending=null;await refresh();closeDialog();return toast(mode==='merge'?'Records merged and synced':'Signed in and synced');
    }
    case 'login-cancel':signInPending=null;await sync.cancelSignIn();return accountForm();
    case 'sync-now':await sync.syncNow();return accountForm();
    case 'sign-out':if(!confirm('Sign out of GitHub sync on this device? Your records stay on this device and in the repository.'))return;await sync.signOut();render();return accountForm();
    case 'project-tab':projectTab=value;return render();
    case 'archived':showArchived=!showArchived;return render();
    case 'period':await write(st=>{st.settings.period=value;});return;
    case 'collapse':await write(st=>{st.settings.collapsed=!st.settings.collapsed;});return;
    case 'new-company':return companyForm();
    case 'new-company-inline':return companyForm('',cid=>projectForm('',cid));
    case 'company':return companyForm(id);
    case 'project':return projectForm(id);
    case 'new-project':return projectForm();
    case 'entry-project':return projectForm('','',pid=>entryForm('',pid));
    case 'entry':return entryForm(id);
    case 'delete-entry':{
      const rev=Number(el.dataset.revision);
      if(!confirm('Delete this entry, its focus history and any confirmed payment?'))return;
      await write(st=>{C.requireThat(C.byId(st.entries,id)?.revision===rev,'This entry changed. Reopen it before deleting.');st.entries=st.entries.filter(e=>e.id!==id);st.payments=st.payments.filter(v=>v.entryId!==id);},'Delete entry',id);closeDialog();return toast('Entry deleted');
    }
    case 'project-menu':return menu(p);
    case 'choose-timer':return chooseTimer();
    case 'quick':if(C.conditionOf(C.active(s,id))!=='Running')return menu(p,true);name='focus';break;
    case 'favourites':return favouritesForm();
    case 'fav-up':case 'fav-down':await write(st=>{C.moveFavourite(st,id,name==='fav-up'?-1:1);},'Reorder favourites');return favouritesForm();
    case 'pin':case 'menu-pin':await write(st=>{const v=C.byId(st.projects,id);v.favourite=!v.favourite;if(v.favourite)v.order=Math.max(0,...st.projects.map(x=>x.order))+1;},'Change favourite',id);return name==='pin'?favouritesForm():closeDialog();
    case 'backup-save':{
      const stamp=Date.now();const fresh=await db.read();fresh.settings.backupAt=stamp;
      downloadFile(C.encodeBackup(fresh,stamp),'application/json','TimeLedger-'+(example?'example-':'')+C.keyDate(stamp)+'.json');
      await write(st=>{st.settings.backupAt=stamp;});backupForm();return toast('Backup download started');
    }
    case 'restore-merge':case 'restore-replace':{
      C.requireThat(backupPending,'Choose a valid backup file first.');
      const replace=name==='restore-replace';
      if(!confirm(replace?'Replace every record and setting in this workspace with the backup?':'Merge the selected backup into this workspace?'))return;
      await write(st=>replace?structuredClone(backupPending):C.mergeBackup(st,backupPending),replace?'Restore backup':'Merge backup');backupPending=null;closeDialog();return toast('Backup restored');
    }
    case 'export':return prepareExport(value);
  }
  if(['start','start-focus','resume','resume-focus','focus','clear-focus','pause','stop'].includes(name)){
    const expected=C.active(s,id)?.id;
    await write((st,at)=>{
      C.requireThat(C.active(st,id)?.id===expected,'The active session changed in another window.');
      if(name==='clear-focus')C.requireThat(C.focused(C.active(st,id)),'Focus changed in another window.');
      if(name==='focus'||name==='clear-focus')C.focus(st,name==='focus'?id:null,at);
      else C.timer(st,name.split('-')[0],id,at,name.endsWith('-focus'));
    },name,id);
    sfx(name==='clear-focus'?'pause':name.split('-')[0]);if(name!=='focus'&&name.endsWith('-focus'))setTimeout(()=>sfx('focus'),200);
    closeDialog();toast(({focus:'Project in focus','clear-focus':'Focus cleared',pause:'Timer paused',stop:'Session saved',resume:'Timer resumed',start:'Timer started','start-focus':'Timer started and focused','resume-focus':'Timer resumed and focused'})[name]);
  }
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el||el.disabled||busy)return;
  busy=true;try{await action(el.dataset.action,el);}catch(err){errorMessage(err);}finally{busy=false;}
});
let hold=null,held=false;
document.addEventListener('pointerdown',e=>{const el=e.target.closest('.quick-main');if(!el)return;held=false;hold=setTimeout(()=>{held=true;menu(C.byId(s.projects,el.dataset.id));},600);});
for(const type of ['pointerup','pointercancel','pointermove'])document.addEventListener(type,()=>clearTimeout(hold));
document.addEventListener('click',e=>{if(held){held=false;e.preventDefault();e.stopImmediatePropagation();}},true);
async function refresh(){if(db){try{s=await db.read();render();}catch(err){errorMessage(err);}}}
addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
addEventListener('online',()=>{render();scheduleSync(0);updateRates();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync(0);});addEventListener('offline',render);
async function boot(){
  try{
    db=await openLedger(example?'example':'personal',example);s=await db.read();db.subscribe(refresh);
    filter=initFilter();view=navs.find(([n])=>'#'+n.toLowerCase()===location.hash)?.[0]??'Today';
    render();setInterval(tick,1000);
    if(!example){
      sync=createSync({ledger:db});
      sync.onChange(st=>{const el=$('.sync-label');if(el)el.textContent=syncLabel();const ss=$('#sync-status');if(ss)ss.textContent=statusText();if(st.state==='synced'&&st.changed&&!sheet.open)refresh();});
      await sync.load();scheduleSync(0);setInterval(()=>{if(!document.hidden)scheduleSync(0);},60000);
    }
    updateRates();
    if('serviceWorker' in navigator){
      try{
        const reg=await navigator.serviceWorker.register('./sw.js');
        const install=reg.installing;if(install)install.addEventListener('statechange',()=>{if(install.state==='redundant')swIssue='Offline setup failed. Reopen online and try again.';});
        await navigator.serviceWorker.ready;swReady=true;
        const msg=$('#offline-state');if(msg)msg.textContent='App files cached for offline use.';
      }catch{swIssue='Offline setup unavailable. Open this app directly from its HTTPS address.';}
    }else swIssue='Service workers require HTTPS or localhost. Open the hosted app to cache it.';
  }catch(err){
    app.innerHTML='<main class="loading"><h1>TimeLedger</h1><p>Unable to open local storage.</p><p>'+h(err.message)+'</p><button class="primary" onclick="location.reload()">Try again</button></main>';
  }
}
boot();
