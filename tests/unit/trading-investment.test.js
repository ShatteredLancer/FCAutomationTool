import {expect,it,vi} from 'vitest';
import {createInvestmentPlan,validateInvestmentPlan} from '../../src/trading/investment-plan.js';
import {createTradingExecutionSession,tradingExecutionKey,readTradingExecution} from '../../src/trading/execution-session.js';
import {createFc27TradingDesk} from '../../src/adapters/browser/fc27-trading-desk.js';

const context={scope:'test-account',season:'27',platform:'console'},now=1793851200000;
const advice=()=>({platform:'console',at:now,validUntil:now+300000,suggestions:Array.from({length:3},(_,i)=>({definitionId:100+i,name:`Candidate ${i}`,rating:80+i,
  sourceCount:2,ggQuote:{expiresAt:now+300000},resaleEstimate:1000,buyCeiling:650,futbinId:500+i,reason:'Two source value gap',nationId:1,leagueId:2,teamId:3,preferredPosition:'CM'}))});
const plan=(extra={})=>createInvestmentPlan({advice:advice(),context,now,id:'plan-test',...extra});

it('makes an aggregate investable list with editable limits, tax, fixed exit and no promise of available offers',()=>{
  const p=plan({capitalLimit:1500});expect(p.rows).toHaveLength(2);expect(p.allocated).toBe(1300);expect(p.expectedNet).toBe(600);
  expect(p.rows.every(r=>r.quantity===1&&r.expectedNet===300)).toBe(true);expect(validateInvestmentPlan(p,context)).toEqual(p);
  expect(plan({capitalLimit:20000}).capitalLimit).toBe(20000);expect(plan({capitalLimit:3000,existingCapital:1500}).rows).toHaveLength(2);
});
it('does not turn single-source, expired, duplicate, unprofitable or over-budget observations into an executable list',()=>{
  const a=advice();a.suggestions[0].sourceCount=1;a.suggestions[1].ggQuote.expiresAt=now;a.suggestions[2].resaleEstimate=500;
  expect(()=>plan({advice:a})).toThrow('NO_CANDIDATES');expect(()=>plan({capitalLimit:200})).toThrow('NO_CANDIDATES');
  expect(()=>plan({advice:{...advice(),validUntil:now}})).toThrow('INVALID');
  expect(()=>validateInvestmentPlan({...plan(),capitalLimit:150},context)).toThrow('INVALID');
  expect(()=>validateInvestmentPlan(plan(),{...context,scope:'other'})).toThrow('INVALID');
});

function fixture({buyUnknown=false,listUnknown=false,dropWrite=false,coins=40000,occupied=0,archiveFailure=null}={}){
  const data=new Map(),calls=[],owned=new Map();let time=now,current=true,inLock=false,session,serial=0;
  const adapter={capabilities:vi.fn(async()=>({canTrade:true,balance:coins,freeSlots:50,occupied})),
    find:vi.fn(async row=>({definitionId:row.definitionId,itemId:10000+row.definitionId,tradeId:String(90000+row.definitionId),price:600})),
    buy:vi.fn(async offer=>{expect(inLock).toBe(true);expect(data.get(tradingExecutionKey('scope')).entries.some(e=>e.phase==='buy-pending'&&e.offer.itemId===offer.itemId)).toBe(true);
      calls.push(['buy',offer.itemId]);if(!buyUnknown)owned.set(offer.itemId,'bought');return buyUnknown?{status:'unknown'}:{...offer,status:'bought'};}),
    move:vi.fn(async e=>{expect(inLock).toBe(true);calls.push(['move',e.offer.itemId]);owned.set(e.offer.itemId,'transfer');return {status:'completed'};}),
    checkListing:vi.fn(async()=>{}),list:vi.fn(async e=>{expect(inLock).toBe(true);calls.push(['list',e.offer.itemId]);
      if(!listUnknown)owned.set(e.offer.itemId,'listed');return {status:'accepted'};}),
    reconcile:vi.fn(async e=>{const phase=owned.get(e.offer.itemId);return phase?{phase,...(['listed','sold'].includes(phase)?{listingTradeId:String(80000+e.definitionId)}:{}),
      ...(phase==='sold'?{salePrice:1000}:{} )}:null;}),cancel:vi.fn()};
  const options={context,scope:'scope',get:async(k,f)=>structuredClone(archiveFailure==='readback'&&k.endsWith(':history')&&data.has(k)?[]:data.get(k)??f),set:async(k,v)=>{expect(inLock).toBe(true);
      if(k.endsWith(':history')&&archiveFailure==='throw')throw Error('archive failed');if(!dropWrite&&!(k.endsWith(':history')&&archiveFailure==='drop'))data.set(k,structuredClone(v));},
    exclusive:async(_scope,fn)=>{expect(inLock).toBe(false);inLock=true;try{return await fn();}finally{inLock=false;}},
    createAdapter:vi.fn(async()=>adapter),assertCurrent:()=>{if(!current)throw Error('DESK_CONTEXT_CHANGED');},now:()=>time};
  session=createTradingExecutionSession(options);
  return {data,adapter,calls,owned,session,createAdapter:options.createAdapter,reload:()=>session=createTradingExecutionSession(options),advance:ms=>time+=ms,changeAccount:()=>current=false,
    makePlan:()=>plan({id:`plan-${++serial}`})};
}
const pristineRecord=()=>{const p=plan();return {schema:1,status:'paused',reason:'DESK_EXECUTION_READ_UNCONFIRMED',plan:p,
  entries:p.rows.map(row=>({definitionId:row.definitionId,phase:'waiting',offer:null}))};};
it('archives a strictly pristine paused batch with readback before replacing it with a separately approved fresh plan',async()=>{
  const f=fixture(),old=pristineRecord(),key=tradingExecutionKey('scope');f.data.set(key,old);f.adapter.find.mockResolvedValue(null);
  await expect(f.session.execute({plan:f.makePlan()})).rejects.toThrow('APPROVAL_REQUIRED');expect(f.data.get(key)).toEqual(old);
  const result=await f.session.execute({plan:f.makePlan(),approved:true});expect(result.record.plan.id).not.toBe(old.plan.id);
  expect(f.data.get(key+':history')).toEqual([old]);expect(result.record.status).toBe('completed');expect(f.calls).toEqual([]);
});
it.each(['throw','drop','readback'])('does not replace a pristine batch or dispatch when its archive fails (%s)',async archiveFailure=>{
  const f=fixture({archiveFailure}),old=pristineRecord(),key=tradingExecutionKey('scope');f.data.set(key,old);
  await expect(f.session.execute({plan:f.makePlan(),approved:true})).rejects.toThrow(archiveFailure==='throw'?'archive failed':'SAVE_UNVERIFIED');
  expect(f.data.get(key)).toEqual(old);expect(f.createAdapter).not.toHaveBeenCalled();expect(f.adapter.find).not.toHaveBeenCalled();expect(f.calls).toEqual([]);
});
it.each([
  {offer:{definitionId:100,itemId:10100,tradeId:'90100',price:600}},
  {buyAcknowledged:true},{buyAcknowledged:false},{listAcknowledged:false},{listingTradeId:'80000'},
  {salePrice:1000},{soldAt:now},{pending:false},{unrecognizedEvidence:null},
  {phase:'buy-pending',offer:{definitionId:100,itemId:10100,tradeId:'90100',price:600}},
  {phase:'move-pending',offer:{definitionId:100,itemId:10100,tradeId:'90100',price:600}},
  {phase:'list-pending',offer:{definitionId:100,itemId:10100,tradeId:'90100',price:600}},
])('preserves nonpristine waiting or pending evidence instead of relying on zero confirmed/pending aggregates (%j)',async evidence=>{
  const f=fixture(),old=pristineRecord(),key=tradingExecutionKey('scope');Object.assign(old.entries[0],evidence);f.data.set(key,structuredClone(old));
  await expect(f.session.execute({plan:f.makePlan(),approved:true})).rejects.toThrow('RECOVERY_REQUIRED');
  expect(f.data.get(key)).toEqual(old);expect(f.data.has(key+':history')).toBe(false);expect(f.calls).toEqual([]);
});
it('actually performs a readonly preflight before clearing a pristine READ_UNCONFIRMED reason',async()=>{
  const f=fixture(),old=pristineRecord(),key=tradingExecutionKey('scope');f.data.set(key,old);
  const result=await f.session.recover();expect(f.adapter.capabilities).toHaveBeenCalledOnce();expect(result.record.reason).toBeNull();
  const options=f.createAdapter.mock.calls[0][1];expect(options.readOnly).toBe(true);expect(options.canWrite()).toBe(false);
  expect(result.record.entries).toEqual(old.entries);expect(f.calls).toEqual([]);expect(f.adapter.find).not.toHaveBeenCalled();
});
it('keeps the real preflight failure on pristine recovery and never dispatches',async()=>{
  const f=fixture(),old=pristineRecord(),key=tradingExecutionKey('scope');f.data.set(key,old);f.adapter.capabilities.mockRejectedValue(Error('DESK_EXECUTION_READ_UNCONFIRMED'));
  await expect(f.session.recover()).rejects.toThrow('DESK_EXECUTION_READ_UNCONFIRMED');expect(f.data.get(key)).toEqual(old);expect(f.calls).toEqual([]);
});
it.each([{buyAcknowledged:false},null])('does not erase unrelated/nonpristine waiting reasons without a native read (%j)',async evidence=>{
  const f=fixture(),old=pristineRecord(),key=tradingExecutionKey('scope');if(evidence)Object.assign(old.entries[0],evidence);else old.reason='DESK_EXECUTION_REFERENCE_CHANGED';f.data.set(key,old);
  const result=await f.session.recover();expect(result.record.reason).toBe(old.reason);expect(f.adapter.capabilities).not.toHaveBeenCalled();expect(f.adapter.reconcile).not.toHaveBeenCalled();expect(f.calls).toEqual([]);
});
it('requires a separate approval; preview/read/stop do not buy or list',async()=>{
  const f=fixture();expect(await f.session.inspect()).toEqual({record:null,running:false});f.session.stop();
  await expect(f.session.execute({plan:plan()})).rejects.toThrow('APPROVAL_REQUIRED');expect(f.calls).toEqual([]);expect(f.data.size).toBe(0);
});
it('buys and lists exact new entities once, persists intents first, distinguishes listing from realized profit',async()=>{
  const f=fixture();const result=await f.session.execute({plan:plan(),approved:true});
  expect(result.record.status).toBe('waiting-sales');expect(result.record.entries.map(e=>e.phase)).toEqual(['listed','listed','listed']);
  expect(f.adapter.buy).toHaveBeenCalledTimes(3);expect(f.adapter.list).toHaveBeenCalledTimes(3);
  const copy=f.reload();expect((await copy.inspect()).record.status).toBe('waiting-sales');expect(f.adapter.buy).toHaveBeenCalledTimes(3);
  for(const e of result.record.entries)f.owned.set(e.offer.itemId,'sold');
  const recovered=await copy.recover();expect(recovered.record.status).toBe('completed');expect(f.adapter.buy).toHaveBeenCalledTimes(3);expect(f.adapter.list).toHaveBeenCalledTimes(3);
  await expect(copy.execute({plan:plan(),approved:true})).rejects.toThrow('DESK_EXECUTION_ALREADY_STARTED');expect(f.adapter.buy).toHaveBeenCalledTimes(3);
});
it.each([['buy',true,false],['list',false,true]])('never repeats an uncertain %s across stop, reload and explicit resume',async(_phase,buyUnknown,listUnknown)=>{
  const f=fixture({buyUnknown,listUnknown}),first=await f.session.execute({plan:plan(),approved:true});
  expect(first.record.status).toBe('recovery-required');const buys=f.adapter.buy.mock.calls.length,lists=f.adapter.list.mock.calls.length;
  f.session.stop();const fresh=f.reload();await fresh.recover();await fresh.execute({resume:true,approved:true});
  expect(f.adapter.buy).toHaveBeenCalledTimes(buys);expect(f.adapter.list).toHaveBeenCalledTimes(lists);
});
it('does not dispatch a payment when GM write/readback fails',async()=>{
  const f=fixture({dropWrite:true});await expect(f.session.execute({plan:plan(),approved:true})).rejects.toThrow('SAVE_UNVERIFIED');expect(f.adapter.buy).not.toHaveBeenCalled();
});
it.each([{coins:500},{coins:40000,occupied:20000}])('rechecks real balance and outstanding manual exposure before spending (%j)',async settings=>{
  const f=fixture(settings),result=await f.session.execute({plan:plan(),approved:true});expect(result.record.reason).toBe('DESK_EXECUTION_FUNDS_OR_CAPACITY');expect(f.calls).toEqual([]);
});
it('does not raise a buy limit, buy an incorrect version, or buy again after all offers are gone',async()=>{
  const f=fixture();f.adapter.find.mockResolvedValue(null);expect((await f.session.execute({plan:plan(),approved:true})).record.status).toBe('completed');expect(f.calls).toEqual([]);
  const g=fixture();g.adapter.find.mockResolvedValue({definitionId:999,itemId:10,tradeId:'123',price:600});
  expect((await g.session.execute({plan:plan(),approved:true})).record.reason).toBe('DESK_EXECUTION_OFFER_INVALID');expect(g.calls).toEqual([]);
  const h=fixture();h.adapter.find.mockImplementation(async r=>({definitionId:r.definitionId,itemId:10,tradeId:'123',price:700}));
  expect((await h.session.execute({plan:plan(),approved:true})).record.reason).toBe('DESK_EXECUTION_OFFER_INVALID');expect(h.calls).toEqual([]);
});
it('honors stop during a confirmed buy without losing ownership or sending a move/list',async()=>{
  const f=fixture(),original=f.adapter.buy.getMockImplementation();f.adapter.buy.mockImplementation(async offer=>{const result=await original(offer);f.session.stop();return result;});
  const result=await f.session.execute({plan:plan(),approved:true});expect(result.record.status).toBe('paused');expect(result.record.entries[0].phase).toBe('bought');
  expect(f.adapter.buy).toHaveBeenCalledOnce();expect(f.adapter.move).not.toHaveBeenCalled();expect(f.adapter.list).not.toHaveBeenCalled();
  f.adapter.buy.mockImplementation(original);f.advance(300001);const resume=await f.reload().execute({resume:true,approved:true});
  expect(resume.record.entries[0].phase).toBe('listed');expect(f.adapter.buy).toHaveBeenCalledOnce();
});
it('retains current receipts on account switch and will not send another mutation',async()=>{
  const f=fixture();f.adapter.find.mockImplementation(async()=>{f.changeAccount();return null;});
  await expect(f.session.execute({plan:plan(),approved:true})).rejects.toThrow('CONTEXT_CHANGED');expect(f.calls).toEqual([]);
  expect(f.data.get(tradingExecutionKey('scope')).entries[0].phase).toBe('waiting');
});
it('can resume after stop before dispatch without inventing an unknown payment',async()=>{
  const f=fixture();f.adapter.buy.mockRejectedValueOnce(Error('DESK_EXECUTION_NOT_SENT'));
  const first=await f.session.execute({plan:plan(),approved:true});expect(first.record.status).toBe('paused');expect(first.record.entries[0]).toMatchObject({phase:'waiting',offer:null});
  expect(f.calls).toEqual([]);await f.session.execute({resume:true,approved:true});expect(f.calls.filter(c=>c[0]==='buy')).toHaveLength(3);
});
it('stops on unknown business rejections rather than repeatedly bidding through a captcha or service error',async()=>{
  const f=fixture();f.adapter.buy.mockResolvedValue({status:'rejected',reason:'FC27_BUY_REJECTED',httpStatus:200});
  const result=await f.session.execute({plan:plan(),approved:true});expect(result.record.status).toBe('paused');expect(result.record.reason).toBe('DESK_EXECUTION_SERVICE_STOP');
  expect(f.adapter.buy).toHaveBeenCalledOnce();expect(f.adapter.find).toHaveBeenCalledOnce();expect(f.adapter.move).not.toHaveBeenCalled();
});
it('does not erase an ambiguous 5xx buy intent just because the old adapter labels its response rejected',async()=>{
  const f=fixture();f.adapter.buy.mockResolvedValue({status:'rejected',reason:'FC27_BUY_REJECTED',httpStatus:503});
  const first=await f.session.execute({plan:plan(),approved:true});expect(first.record.status).toBe('recovery-required');expect(first.record.entries[0].phase).toBe('buy-pending');
  await f.reload().execute({resume:true,approved:true});expect(f.adapter.buy).toHaveBeenCalledOnce();expect(f.adapter.move).not.toHaveBeenCalled();
});
it('rejects corrupt journals and never clears one to get a new plan through',()=>{
  const p=plan(),value={schema:1,status:'recovery-required',plan:p,entries:p.rows.map(r=>({definitionId:r.definitionId,phase:'buy-pending',offer:null}))};
  expect(()=>readTradingExecution(value,context)).toThrow('EXECUTION_INVALID');
});
it('mints a plan only from current server-discovered suggestions and leaves old main journals unchanged',async()=>{
  const data=new Map([['protected-journal',{pending:true}]]),execution={prepare:vi.fn(p=>({plan:p,balance:40000})),start:vi.fn(),inspect:vi.fn(),stop:vi.fn()};
  const a=advice(),quotes=Object.fromEntries(a.suggestions.map(r=>[r.definitionId,{quotes:{futgg:{source:'futgg',definitionId:r.definitionId,season:'27',platform:'console',
    price:1000,fetchedAt:now,expiresAt:now+300000,sourceUpdatedAt:null,error:null}}}]));
  const prices={context:()=>context,readSettings:async()=>({source:'futbin',readSources:'both'}),tradingCandidates:async()=>({at:now,platform:'console',rows:a.suggestions.map(r=>({...r,season:'27',platform:'console',price:1000,fetchedAt:now}))}),load:async()=>({references:quotes})};
  const desk=createFc27TradingDesk({prices,execution,get:async(k,f)=>data.get(k)??f,set:async(k,v)=>data.set(k,v),locks:{request:async(_k,_o,fn)=>fn()},now:()=>now,id:()=> 'minted'});
  await expect(desk.prepareInvestment()).rejects.toThrow('DISCOVERY_EXPIRED');await desk.discover();
  const result=await desk.prepareInvestment({capitalLimit:20000});expect(result.plan.capitalLimit).toBe(20000);expect(execution.start).not.toHaveBeenCalled();
  expect((await desk.prepareInvestment({capitalLimit:20000,definitionIds:[100]})).plan.rows).toHaveLength(1);
  await expect(desk.prepareInvestment({definitionIds:[999]})).rejects.toThrow('DESK_PLAN_INVALID');
  expect(data.get('protected-journal')).toEqual({pending:true});
});
