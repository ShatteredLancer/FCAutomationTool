// Account-scoped task configuration. This schema is not an execution permit.
const own=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('TASKS_INVALID');};
const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('TASKS_INVALID');return v;};
const text=(v,max=100)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('TASKS_INVALID');return v.trim();};
const one=(v,values)=>{if(!values.includes(v))throw Error('TASKS_INVALID');return v;};
const optional=(v,min=0)=>v===null?null:integer(v,min);
const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw Error('TASKS_STORAGE_LIMIT');return v;};
export const TASK_STORE_LIMIT=1_000_000;
export const defaultTradingTaskSettings=()=>({buyRule:'percent',buyValue:85,sellRule:'reference',sellValue:100,duration:3600,
 taskCap:null,spendCap:null,runMinutes:null,hardCap:null,relist:'original',relistTimes:null,ratingMin:83,ratingMax:85,
 quality:'all',league:null,position:null,perVersion:null,nation:null,club:null});
export const defaultTradingPublicSettings=()=>({source:'futbin',reserve:null,totalCap:null,gapMin:7,gapMax:15,cycleMin:10,cycleMax:15,restMin:5,restMax:8,perSearch:1,hourLimit:1000,dayLimit:5000});
export function tradingTaskContext(value){own(value,['scope','season','platform']);return {scope:text(value.scope,250),season:one(value.season,['27']),platform:one(value.platform,['pc','console'])};}
export function tradingPublicSettings(input){own(input,Object.keys(defaultTradingPublicSettings()));const s={...defaultTradingPublicSettings(),...input};one(s.source,['futbin','futgg','both']);s.reserve=optional(s.reserve);s.totalCap=optional(s.totalCap,150);
 for(const key of ['gapMin','gapMax','cycleMin','cycleMax','perSearch','hourLimit','dayLimit'])integer(s[key],1);for(const key of ['restMin','restMax'])integer(s[key]);
 for(const [a,b]of [['gapMin','gapMax'],['cycleMin','cycleMax'],['restMin','restMax']])if(s[a]>s[b])throw Error('TASKS_INVALID');return s;}
export function normalizeTradingTaskInput(value){own(value,['name','mode','settings','players','owned','excluded']);const name=text(value.name,60),mode=one(value.mode,['fixed','filter','sell']);
 own(value.settings,Object.keys(defaultTradingTaskSettings()));const s={...defaultTradingTaskSettings(),...value.settings};one(s.buyRule,['percent','fixed']);one(s.sellRule,['reference','fixed']);
 integer(s.buyValue,s.buyRule==='fixed'?150:1,s.buyRule==='fixed'?15000000:10000);integer(s.sellValue,s.sellRule==='fixed'?150:1,s.sellRule==='fixed'?15000000:10000);
 one(s.duration,[3600,10800,21600,43200,86400,259200]);one(s.relist,['original','reference','pause']);
 for(const key of ['taskCap','spendCap','hardCap'])s[key]=optional(s[key],150);if(s.hardCap!==null)integer(s.hardCap,150,15000000);for(const key of ['perVersion','runMinutes'])s[key]=optional(s[key],1);s.relistTimes=optional(s.relistTimes);
 integer(s.ratingMin,1,99);integer(s.ratingMax,s.ratingMin,99);one(s.quality,['all','gold','silver','bronze','special']);for(const key of ['league','nation','club'])s[key]=optional(s[key],1);if(s.position!==null)integer(s.position,0,100);
 const players=list(value.players,500).map(p=>{own(p,['definitionId','name','rating','version','cap','qty']);return {definitionId:integer(p.definitionId,1),name:text(p.name),rating:integer(p.rating,1,99),version:typeof p.version==='string'?p.version.slice(0,80):'',cap:p.cap===null?null:integer(p.cap,150,15000000),qty:optional(p.qty,1)};});
 const owned=list(value.owned,500).map(p=>{own(p,['itemId','definitionId','name','pile']);const itemId=text(p.itemId,30);if(!/^\d+$/.test(itemId))throw Error('TASKS_INVALID');return {itemId,definitionId:integer(p.definitionId,1),name:text(p.name),pile:one(p.pile,['club','transfer','unassigned'])};});
 const excluded=list(value.excluded,500).map(e=>{own(e,['type','id','label']);return {type:one(e.type,['version','player']),id:integer(e.id,1),label:text(e.label,160)};});
 for(const [rows,key]of [[players,p=>p.definitionId],[owned,p=>p.itemId],[excluded,p=>`${p.type}:${p.id}`]])if(new Set(rows.map(key)).size!==rows.length)throw Error('TASKS_INVALID');
 if(mode==='fixed'&&!players.length||mode==='sell'&&!owned.length)throw Error('TASKS_SELECTION_EMPTY');
 return {name,mode,settings:s,players,owned,excluded};
}
export const emptyTaskActivity=()=>({receipts:[],unresolved:false});
export const emptyTradingTasks=context=>({schema:1,context:tradingTaskContext(context),revision:0,settings:defaultTradingPublicSettings(),tasks:[]});
export function readTradingTasks(input,context){if(input===null||input===undefined)return emptyTradingTasks(context);
 if(JSON.stringify(input).length>TASK_STORE_LIMIT)throw Error('TASKS_STORAGE_LIMIT');own(input,['schema','context','revision','settings','tasks']);
 if(input.schema!==1||JSON.stringify(tradingTaskContext(input.context))!==JSON.stringify(tradingTaskContext(context)))throw Error('TASKS_CONTEXT_INVALID');
 const store={schema:1,context:tradingTaskContext(context),revision:integer(input.revision),settings:tradingPublicSettings(input.settings),tasks:list(input.tasks,100).map(t=>{
  own(t,['id','revision','name','mode','settings','players','owned','excluded','state','createdAt','updatedAt','activity']);const {name,mode,settings,players,owned,excluded}=t;
  own(t.activity,['receipts','unresolved']);if(typeof t.activity.unresolved!=='boolean')throw Error('TASKS_INVALID');
  const receipts=list(t.activity.receipts,1000).map(r=>{own(r,['kind','itemId','definitionId','coins','at']);return {kind:one(r.kind,['bought','moved','listed','sold']),itemId:text(r.itemId,30),definitionId:integer(r.definitionId,1),coins:optional(r.coins),at:integer(r.at)};});
  return {id:text(t.id,100),revision:integer(t.revision??0),...normalizeTradingTaskInput({name,mode,settings,players,owned,excluded}),state:one(t.state,['ready','queued','running','paused','stopped','archived','review']),createdAt:integer(t.createdAt),updatedAt:integer(t.updatedAt),activity:{receipts,unresolved:t.activity.unresolved}};
 })};if(new Set(store.tasks.map(t=>t.id)).size!==store.tasks.length)throw Error('TASKS_INVALID');return store;
}
