import {TASK_STORE_LIMIT,tradingTaskContext,tradingPublicSettings,normalizeTradingTaskInput,emptyTaskActivity,readTradingTasks} from '../../trading/task-model.js';

export const tradingTaskKey=context=>{const c=tradingTaskContext(context);return `fcat-fc27-market-tasks-v1:${encodeURIComponent(c.scope)}:${c.season}:${c.platform}`;};
export function createTradingTaskStore({context,get,set,locks,now=()=>Date.now(),id=()=>globalThis.crypto.randomUUID()}){
 const capture=()=>tradingTaskContext(context());
 const current=c=>{if(JSON.stringify(capture())!==JSON.stringify(c))throw Error('TASKS_CONTEXT_CHANGED');};
 const read=async()=>{const c=capture(),store=readTradingTasks(await get(tradingTaskKey(c),null),c);current(c);return {context:c,store};};
 const mutate=async(snapshot,fn)=>{const c=tradingTaskContext(snapshot.context);current(c);if(!locks?.request)throw Error('TASKS_LOCK_UNAVAILABLE');
  return locks.request(tradingTaskKey(c),{mode:'exclusive'},async()=>{current(c);const key=tradingTaskKey(c),store=readTradingTasks(await get(key,null),c);current(c);
   if(store.revision!==snapshot.store?.revision)throw Error('TASKS_STALE');fn(store);store.revision++;const next=readTradingTasks(store,c),serialized=JSON.stringify(next);
   if(new globalThis.TextEncoder().encode(serialized).length>TASK_STORE_LIMIT)throw Error('TASKS_STORAGE_LIMIT');current(c);await set(key,next);current(c);
   if(JSON.stringify(await get(key,null))!==serialized)throw Error('TASKS_SAVE_UNVERIFIED');current(c);return {context:c,store:readTradingTasks(next,c)};
  });};
 const find=(store,key)=>{const task=store.tasks.find(t=>t.id===key);if(!task)throw Error('TASKS_NOT_FOUND');return task;};
 const config=t=>normalizeTradingTaskInput({name:t.name,mode:t.mode,settings:t.settings,players:t.players,owned:t.owned,excluded:t.excluded});
 return Object.freeze({context:capture,read,
  saveTask:options=>{const input=normalizeTradingTaskInput(options.input);return mutate(options,store=>{if(options.id){const t=find(store,options.id);if(!['ready','paused'].includes(t.state)||t.activity.unresolved)throw Error('TASKS_EDIT_BLOCKED');Object.assign(t,input,{updatedAt:now()});}
   else store.tasks.push({id:id(),...input,state:'ready',createdAt:now(),updatedAt:now(),activity:emptyTaskActivity()});});},
  saveSettings:options=>{const settings=tradingPublicSettings(options.settings);return mutate(options,store=>{store.settings=settings;for(const t of store.tasks)if(['running','queued'].includes(t.state)){t.state='paused';t.updatedAt=now();}});},
  action:options=>mutate(options,store=>{if(options.action==='pause-all'){for(const t of store.tasks)if(['running','queued'].includes(t.state)){t.state='paused';t.updatedAt=now();}return;}
   const t=find(store,options.id);if(options.action==='copy'){store.tasks.push({id:id(),...config(t),name:(t.name.slice(0,55)+' · 副本'),state:'ready',createdAt:now(),updatedAt:now(),activity:emptyTaskActivity()});return;}
   if(options.action==='pause'){if(['running','queued'].includes(t.state))t.state='paused';t.updatedAt=now();return;}
   if(t.activity.unresolved||t.state==='review')throw Error('TASKS_UNRESOLVED');
   if(options.action==='stop'){t.state='stopped';t.updatedAt=now();return;}
   if(options.action==='delete'){if(t.activity.receipts.length){t.state='archived';t.updatedAt=now();}else store.tasks=store.tasks.filter(r=>r!==t);return;}
   // P1 has no executor. A stored flag must never masquerade as live execution.
   throw Error('TASKS_EXECUTION_UNAVAILABLE');
  }),
 });
}
