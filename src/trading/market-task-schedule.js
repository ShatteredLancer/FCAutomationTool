// Local wall times are resolved in the saved IANA zone. Missing/repeated DST
// times fail explicitly; no timer or execution authority lives in this module.
const fail = (reason = 'INVALID') => { throw Error(`MARKET_SCHEDULE_${reason}`); };
const DAY = 86400000;
const stamp = n => Number.isSafeInteger(n) && n >= 0;
const own = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail(); };
const formatter = zone => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }); } catch { fail(); } };
const parts = (f, n) => Object.fromEntries(f.formatToParts(n).map(p => [p.type, p.value]));
function localEpoch(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) fail();
 const n=Date.parse(`${value}:00Z`); if (!stamp(n) || new Date(n).toISOString().slice(0,16)!==value) fail(); return n;
}
const resolvedTimes = new Map();
function resolve(value, zone) {
 const key=JSON.stringify([value,zone]);if(resolvedTimes.has(key))return resolvedTimes.get(key);
 const naive=localEpoch(value), f=formatter(zone), possible=new Set();
 for(let shift=-36;shift<=36;shift+=6){
  const probe=naive+shift*3600000,p=parts(f,probe),offset=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)-probe;
  const t=naive-offset,q=parts(f,t);
  if(`${q.year}-${q.month}-${q.day}T${q.hour}:${q.minute}`===value)possible.add(t);
 }
 if(possible.size!==1)fail('TIME_AMBIGUOUS');const result=[...possible][0];if(resolvedTimes.size>=256)resolvedTimes.delete(resolvedTimes.keys().next().value);resolvedTimes.set(key,result);return result;
}
const dateIn = (zone, n) => {const p=parts(formatter(zone),n);return `${p.year}-${p.month}-${p.day}`;};
const nextDate = date => new Date(localEpoch(`${date}T00:00`)+DAY).toISOString().slice(0,10);
export function normalizeMarketSchedule(input, mode) {
 if(input==null)return null;
 own(input,['repeat','zone','start','end','sell']);
 const s={...input};if(!['once','daily'].includes(s.repeat)||typeof s.zone!=='string'||s.zone.length>100)fail();formatter(s.zone);
 if(mode==='sell'&&(s.end!==null||s.sell!==null))fail();
 if(s.repeat==='daily'){
  for(const v of [s.start,s.end,s.sell])if(v!==null&&(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)))fail();
  if(s.start===null||s.end===s.start)fail();
 }else{
  const start=resolve(s.start,s.zone),end=s.end===null?null:resolve(s.end,s.zone),sell=s.sell===null?null:resolve(s.sell,s.zone);
  if(end!==null&&end<=start||sell!==null&&sell<start)fail();
 }
 return s;
}
export function marketScheduleWindow(s, now, date = null) {
 let startAt,endAt,sellAt,nextAt=null;
 if(s.repeat==='once'){
  startAt=resolve(s.start,s.zone);endAt=s.end===null?null:resolve(s.end,s.zone);sellAt=s.sell===null?startAt:resolve(s.sell,s.zone);
 }else{
  const day=date??dateIn(s.zone,now),next=nextDate(day);
  startAt=resolve(`${day}T${s.start}`,s.zone);
  endAt=s.end===null?null:resolve(`${s.end<s.start?next:day}T${s.end}`,s.zone);
  sellAt=s.sell===null?startAt:resolve(`${s.sell<s.start?next:day}T${s.sell}`,s.zone);
  // Resolve the next start only when rolling over. A future DST ambiguity must
  // not cancel the preceding, valid day's trades.
  try { nextAt=resolve(`${next}T${s.start}`,s.zone); } catch(error) { if(error.message!=='MARKET_SCHEDULE_TIME_AMBIGUOUS')throw error; }
 }
 return {startAt,endAt,sellAt,nextAt,buyClosed:null};
}
export function advanceMarketSchedule(state, task, now) {
 if(!task.schedule)return null;
 const binding=JSON.stringify([task.mode,task.schedule]);state.schedules??=[];
 let row=state.schedules.find(r=>r.taskId===task.id);
 if(!row||row.binding!==binding){
  const value={taskId:task.id,binding,...marketScheduleWindow(task.schedule,now)};
  if(row)Object.assign(row,value);else{row=value;state.schedules.push(row);}
 }
 if(row.endAt!==null&&now>=row.endAt)row.buyClosed??='deadline';
 if(task.mode==='sell')row.buyClosed??='sell-only';
 if(task.schedule.repeat==='daily'&&row.buyClosed&&(row.nextAt===null||now>=row.nextAt)){
  const today=marketScheduleWindow(task.schedule,now);
  if(today.startAt>row.startAt&&now>=today.startAt)Object.assign(row,today,{buyClosed:task.mode==='sell'?'sell-only':null});
  if(row.endAt!==null&&now>=row.endAt)row.buyClosed??='deadline';
 }
 return row;
}
export function marketScheduleGate(task,row,kind,holding,now){
 if(!task.schedule)return true;if(!row)return false;
 if(['search','buy'].includes(kind))return !row.buyClosed&&now>=row.startAt&&(row.endAt===null||now<row.endAt);
 if(kind==='claim')return now>=row.sellAt;
 if(kind==='list')return Boolean(holding?.previousTradeId)||now>=(holding?.sellAt??row.sellAt);
 return true;
}
// null means a one-shot schedule has no remaining actions. Listed holdings
// still need receipt reads; their provider supplies the ordinary paced wait.
export function marketScheduleWake(task,row,holdings,now,canRelist=()=>true){
 if(!task.schedule)return now;
 const held=holdings.filter(h=>h.taskId===task.id&&h.phase!=='sold');
 if(held.some(h=>['held','listed'].includes(h.phase)||h.phase==='unsold'&&canRelist(h)))return now;
 const times=held.filter(h=>h.phase==='transfer').map(h=>h.sellAt??row.sellAt);
 if(task.mode==='sell'){
  if(task.owned.some(p=>!holdings.some(h=>h.itemId===p.itemId)))times.push(row.sellAt);
 }else if(!row.buyClosed)times.push(row.startAt);
 if(task.schedule.repeat==='daily'&&row.buyClosed)times.push(row.nextAt??now+60000);
 return times.length?Math.max(now,Math.min(...times)):null;
}
export function validateMarketSchedules(rows){
 if(!Array.isArray(rows)||rows.length>1000)fail();const seen=new Set();
 for(const r of rows){
  own(r,['taskId','binding','startAt','endAt','sellAt','nextAt','buyClosed']);
  if(typeof r.taskId!=='string'||!r.taskId||r.taskId.length>120||seen.has(r.taskId)||typeof r.binding!=='string'||r.binding.length>1000
   ||!stamp(r.startAt)||!stamp(r.sellAt)||r.sellAt<r.startAt||r.endAt!==null&&(!stamp(r.endAt)||r.endAt<=r.startAt)
   ||r.nextAt!==null&&!stamp(r.nextAt)||![null,'full','deadline','sell-only'].includes(r.buyClosed))fail();
  seen.add(r.taskId);
 }
}
