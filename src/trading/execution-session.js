import {validateInvestmentPlan} from './investment-plan.js';

export const tradingExecutionKey=scope=>`fcat-fc27-trading-execution-v1:${scope}`;
const phases=new Set(['waiting','buy-pending','bought','move-pending','transfer','holding','list-pending','listed','sold','skipped','rejected']);
const pending=new Set(['buy-pending','move-pending','list-pending']);
const terminal=new Set(['sold','skipped','rejected']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const targetHold=row=>row.strategy==='evo-event'&&row.event.exitMode==='target-hold';
const settledStatus=record=>record.entries.some(e=>pending.has(e.phase))?'recovery-required'
  :record.entries.every(e=>terminal.has(e.phase))?'completed':record.entries.some(e=>e.phase==='holding')?'waiting-events'
    :record.entries.some(e=>['waiting','bought','transfer'].includes(e.phase))?'paused':'waiting-sales';
// Fail closed on any extra entry evidence, including unknown future fields.
// Zero aggregate counts alone say nothing about whether an intent was sent.
const pristine=record=>record.entries.every(e=>e.phase==='waiting'&&e.offer===null
  &&Object.keys(e).every(key=>['definitionId','phase','offer'].includes(key)));
const validOffer=(offer,row)=>offer&&offer.definitionId===row.definitionId&&Number.isSafeInteger(offer.itemId)&&offer.itemId>0
  &&typeof offer.tradeId==='string'&&/^[1-9]\d{0,19}$/.test(offer.tradeId)&&Number.isSafeInteger(offer.price)&&offer.price>=150&&offer.price<=row.buyCap;
const applyReconciliation=(entry,result)=>{
  const allowed={'buy-pending':['bought'],'move-pending':['transfer'],'list-pending':['listed','sold'],listed:['sold']};
  if(!allowed[entry.phase]?.includes(result?.phase))return;
  for(const key of ['phase','listingTradeId','salePrice','soldAt'])if(result[key]!==undefined)entry[key]=result[key];
};
export function readTradingExecution(value,context){
  if(value==null)return null;validateInvestmentPlan(value.plan,context);
  if(value.schema!==1||!['active','paused','waiting-sales','waiting-events','completed','recovery-required'].includes(value.status)||!Array.isArray(value.entries)
    ||value.entries.length!==value.plan.rows.length||JSON.stringify(value).length>100000)throw Error('DESK_EXECUTION_INVALID');
  for(let i=0;i<value.entries.length;i++){const e=value.entries[i],row=value.plan.rows[i];
    if(e.definitionId!==row.definitionId||!phases.has(e.phase)||e.offer!=null&&!validOffer(e.offer,row)
      ||!['waiting','skipped','rejected'].includes(e.phase)&&!e.offer)throw Error('DESK_EXECUTION_INVALID');
    if(e.phase==='holding'&&!targetHold(row))throw Error('DESK_EXECUTION_INVALID');
    if(['listed','sold'].includes(e.phase)&&!(typeof e.listingTradeId==='string'&&/^[1-9]\d{0,19}$/.test(e.listingTradeId)))throw Error('DESK_EXECUTION_INVALID');
    if(e.phase==='sold'&&(!Number.isSafeInteger(e.salePrice)||e.salePrice<row.sellPrice||e.salePrice>15000000))throw Error('DESK_EXECUTION_INVALID');
  }
  if(value.status==='waiting-events'&&(!value.entries.some(e=>e.phase==='holding')||value.entries.some(e=>pending.has(e.phase))))throw Error('DESK_EXECUTION_INVALID');
  return structuredClone(value);
}

// One finite approved batch. A durable pending intent is never automatically
// resent. Reload/recovery is read-only until the next explicit user approval.
export function createTradingExecutionSession({context,scope,get,set,exclusive,createAdapter,assertCurrent=()=>{},checkOtherTransactions=async()=>{},now=()=>Date.now(),onProgress=()=>{},onDiagnostic=()=>{}}){
  let stopped=true,busy=false,currentPhase='idle';
  const key=tradingExecutionKey(scope);
  const report=(event,phase,status,record=null,error=null)=>{
    try{
    const entries=record?.entries??[],confirmed=entries.filter(e=>['bought','move-pending','transfer','holding','list-pending','listed','sold'].includes(e.phase));
    const summary={area:'trading',event,phase,status,source:phase==='inspect'?'stored-journal':'automatic-trading',requestedCount:record?.plan?.rows?.length??0,count:confirmed.length,
      pendingWriteCount:entries.filter(e=>pending.has(e.phase)).length,approvedBudget:record?.plan?.capitalLimit,
      spent:confirmed.reduce((sum,e)=>sum+(e.offer?.price??0),0),ownedCount:confirmed.filter(e=>e.phase!=='sold').length,
      acceptedCount:entries.filter(e=>e.phase==='listed').length,skippedCount:entries.filter(e=>e.phase==='skipped').length,
      reason:/^(DESK|FC27)_[A-Z0-9_]+$/.test(error?.message??'')?error.message
        :event==='execution-stage'?null:record?.reason??(error?.message?'DESK_EXECUTION_UNCONFIRMED':null),
      httpStatus:error?.httpStatus,errorCode:error?.errorCode,mismatch:error?.mismatch,transportPhase:error?.nativeReadStatus,
      methodPath:error?.methodPath,observedHash:error?.observedHash,expectedHash:error?.expectedHash};
    Promise.resolve(onDiagnostic(summary)).catch(()=>{});
    }catch{/* Optional diagnostics never control execution. */}
  };
  const stage=(phase,record=null)=>{currentPhase=phase;report('execution-stage',phase,'started',record);};
  const response=(value,record)=>report('execution-response',currentPhase,value?.status??'unknown',record,
    {httpStatus:value?.httpStatus??value?.response?.status,errorCode:value?.errorCode??value?.response?.code});
  const read=async()=>{assertCurrent();const result=readTradingExecution(await get(key,null),context);assertCurrent();return result;};
  const write=async record=>{assertCurrent();readTradingExecution(record,context);await set(key,record);
    if(!same(record,await get(key,null)))throw Error('DESK_EXECUTION_SAVE_UNVERIFIED');assertCurrent();
    report('execution-checkpoint',currentPhase,record.status,record);
    try{onProgress(structuredClone(record));}catch{/* Display failure never changes receipts. */}};
  const inspect=async()=>{const record=await read();report('execution-state','inspect',record?.status??'absent',record);return {record,running:busy};};
  async function execute({plan=null,approved=false,resume=false,eventExitsOnly=false,expectedPlanId=null}={}){
    if(approved!==true){const error=Error('DESK_EXECUTION_APPROVAL_REQUIRED');report('execution-result','approval','blocked',null,error);throw error;}
    eventExitsOnly=eventExitsOnly===true;
    if(eventExitsOnly&&resume!==true)throw Error('DESK_EVENT_RESUME_REQUIRED');
    const validPlanId=typeof expectedPlanId==='string'&&expectedPlanId.length>0&&expectedPlanId.length<=100
      &&expectedPlanId.trim()===expectedPlanId&&!/[\u0000-\u001f]/.test(expectedPlanId);
    if((eventExitsOnly||expectedPlanId!==null)&&!validPlanId)throw Error('DESK_EXECUTION_PLAN_ID_REQUIRED');
    if(busy){const error=Error('DESK_EXECUTION_BUSY');report('execution-result','approval','blocked',null,error);throw error;}
    busy=true;stopped=false;let record=null,adapter=null,begun=false,intent=null;stage('preflight');
    try{const result=await exclusive(scope,async()=>{try{
      assertCurrent();await checkOtherTransactions();record=await read();
      // Bind the approval to the journal actually read under this exclusive
      // lock. A different tab's plan must not be paused, overwritten or run.
      if(expectedPlanId!==null&&(resume?record?.plan.id:plan?.id)!==expectedPlanId)throw Error('DESK_EXECUTION_PLAN_MISMATCH');
      if(resume){if(!record)throw Error('DESK_EXECUTION_MISSING');begun=true;}
      else{validateInvestmentPlan(plan,context);if(plan.expiresAt<=now())throw Error('DESK_DISCOVERY_EXPIRED');
        if(record?.plan.id===plan.id)throw Error('DESK_EXECUTION_ALREADY_STARTED');
        if(record&&!record.entries.every(e=>terminal.has(e.phase))&&!pristine(record))throw Error('DESK_EXECUTION_RECOVERY_REQUIRED');
        if(record){const historyKey=key+':history',history=await get(historyKey,[]);
          if(!Array.isArray(history)||history.length>=20)throw Error('DESK_EXECUTION_HISTORY_FULL');
          const archived=[...history,record];assertCurrent();await set(historyKey,archived);if(!same(archived,await get(historyKey,null)))throw Error('DESK_EXECUTION_SAVE_UNVERIFIED');assertCurrent();}
        record={schema:1,status:'active',plan:structuredClone(plan),entries:plan.rows.map(row=>({definitionId:row.definitionId,phase:'waiting',offer:null})),reason:null};begun=true;await write(record);
      }
      // A timer pass is never a second batch: freeze the eligible holdings at
      // entry. Any pre-existing pending intent makes the whole pass read-only.
      const exitRows=new Set(record.entries.filter(e=>e.phase==='holding').map(e=>e.definitionId));
      const readonlyPending=eventExitsOnly&&record.entries.some(e=>pending.has(e.phase));
      const readonlyPass=readonlyPending||eventExitsOnly&&exitRows.size===0||record.entries.every(e=>terminal.has(e.phase)||e.phase==='listed');
      stage('adapter-create',record);
      adapter=await createAdapter(record.plan,{canWrite:()=>!stopped&&!readonlyPass,assertCurrent,onStage:phase=>stage(phase,record),onDiagnostic,
        readOnly:readonlyPass,needsPurchases:!eventExitsOnly&&record.plan.expiresAt>now()&&record.entries.some(e=>e.phase==='waiting')});assertCurrent();record.status='active';record.reason=null;
      for(let i=0;i<record.entries.length;i++){
        const e=record.entries[i],row=record.plan.rows[i];assertCurrent();
        if(stopped){record.status='paused';break;}if(terminal.has(e.phase))continue;
        if(pending.has(e.phase)||e.phase==='listed'){
          stage('receipt-recovery',record);
          const recovered=await adapter.reconcile(e,row);assertCurrent();
          applyReconciliation(e,recovered);await write(record);
          if(pending.has(e.phase)){record.status='recovery-required';record.reason='DESK_EXECUTION_RECEIPT_UNCONFIRMED';break;}
          if(e.phase==='listed'||e.phase==='sold')continue;
        }
        if(eventExitsOnly&&(readonlyPending||!exitRows.has(e.definitionId)||e.phase!=='holding'))continue;
        if(e.phase==='waiting'){
          if(record.plan.expiresAt<=now()){e.phase='skipped';e.reason='DESK_DISCOVERY_EXPIRED';await write(record);continue;}
          stage('funds-capacity',record);const caps=await adapter.capabilities();assertCurrent();
          const spent=record.entries.reduce((n,v)=>n+(v.offer&&!['skipped','rejected'].includes(v.phase)?v.offer.price:0),0);
          if(caps.canTrade!==true||!Number.isSafeInteger(caps.balance)||caps.balance-row.buyCap<record.plan.reserveCoins
            ||spent+row.buyCap+(caps.occupied??record.plan.existingCapital)>record.plan.capitalLimit||!Number.isSafeInteger(caps.freeSlots)||caps.freeSlots<1)throw Error('DESK_EXECUTION_FUNDS_OR_CAPACITY');
          stage('market-search',record);const offer=await adapter.find(row);assertCurrent();
          if(stopped){record.status='paused';break;}if(!offer){e.phase='skipped';e.reason='DESK_EXECUTION_NO_OFFER';await write(record);continue;}
          if(!validOffer(offer,row))throw Error('DESK_EXECUTION_OFFER_INVALID');
          stage('funds-recheck',record);const fresh=await adapter.capabilities();assertCurrent();
          if(fresh.canTrade!==true||!Number.isSafeInteger(fresh.balance)||fresh.balance-offer.price<record.plan.reserveCoins||!Number.isSafeInteger(fresh.freeSlots)||fresh.freeSlots<1
            ||spent+offer.price+(fresh.occupied??record.plan.existingCapital)>record.plan.capitalLimit)throw Error('DESK_EXECUTION_FUNDS_OR_CAPACITY');
          if(record.plan.expiresAt<=now())throw Error('DESK_DISCOVERY_EXPIRED');
          e.offer=structuredClone(offer);e.phase='buy-pending';intent=e;await write(record);assertCurrent();if(stopped){e.phase='waiting';e.offer=null;await write(record);record.status='paused';break;}
          stage('buy',record);const bought=await adapter.buy(offer);intent=null;response(bought,record);
          const localRejection=['FC27_BUY_LISTING_CHANGED','FC27_BUY_INSUFFICIENT_COINS','FC27_BUY_PRICE_APPROVAL_REQUIRED','FC27_BUY_PRICE_CAP_EXCEEDED'].includes(bought?.reason);
          const rejectedTransport=Number.isSafeInteger(bought?.httpStatus)&&(bought.httpStatus>=200&&bought.httpStatus<300||[401,403,427,429].includes(bought.httpStatus));
          if(bought?.status==='rejected'&&(localRejection||rejectedTransport)){e.phase='rejected';e.reason=bought.reason??'DESK_EXECUTION_BUY_REJECTED';await write(record);
            if([401,403,427,429].includes(bought.httpStatus)||!['FC27_BUY_LISTING_UNAVAILABLE','FC27_BUY_LISTING_CHANGED'].includes(bought.reason))throw Error('DESK_EXECUTION_SERVICE_STOP');continue;}
          if(bought?.status==='bought'&&validOffer(bought,row)&&same(offer,{definitionId:bought.definitionId,itemId:bought.itemId,tradeId:bought.tradeId,price:bought.price}))e.buyAcknowledged=true;
          stage('buy-readback',record);const recovered=await adapter.reconcile(e,row);applyReconciliation(e,recovered);await write(record);
          if(e.phase!=='bought')throw Error('DESK_EXECUTION_RECEIPT_UNCONFIRMED');
        }
        if(stopped){record.status='paused';break;}
        if(e.phase==='bought'){
          e.phase='move-pending';intent=e;await write(record);assertCurrent();if(stopped){e.phase='bought';await write(record);record.status='paused';break;}
          stage('move',record);const moved=await adapter.move(e);intent=null;response(moved,record);stage('move-readback',record);const recovered=await adapter.reconcile(e,row);applyReconciliation(e,recovered);await write(record);
          if(e.phase!=='transfer')throw Error('DESK_EXECUTION_RECEIPT_UNCONFIRMED');
        }
        if(stopped){record.status='paused';break;}
        if(e.phase==='transfer'&&targetHold(row)){e.phase='holding';await write(record);}
        if(e.phase==='holding'){
          if(now()>=row.event.reviewAt)throw Error('DESK_EVENT_REVIEW_REQUIRED');
          stage('event-exit',record);const signal=await adapter.eventExit(e,row);assertCurrent();
          if(stopped){record.status='paused';break;}
          if(now()>=row.event.reviewAt||signal?.reviewRequired===true)throw Error('DESK_EVENT_REVIEW_REQUIRED');
          if(signal?.ready!==true)continue;
        }
        if(e.phase==='transfer'||e.phase==='holding'){
          const fromHolding=e.phase==='holding';
          stage('listing-limits',record);await adapter.checkListing(e,row);assertCurrent();
          if(stopped){record.status='paused';break;}
          if(fromHolding&&now()>=row.event.reviewAt)throw Error('DESK_EVENT_REVIEW_REQUIRED');
          e.phase='list-pending';intent=e;await write(record);assertCurrent();
          if(stopped||fromHolding&&now()>=row.event.reviewAt){e.phase=fromHolding?'holding':'transfer';await write(record);
            if(stopped){record.status='paused';break;}throw Error('DESK_EVENT_REVIEW_REQUIRED');}
          stage('list',record);const result=await adapter.list(e,row);intent=null;response(result,record);e.listAcknowledged=result?.status==='accepted'&&result.response?.success===true
            &&Number.isSafeInteger(result.response.status)&&result.response.status>=200&&result.response.status<300;
          stage('listing-readback',record);const recovered=await adapter.reconcile(e,row);applyReconciliation(e,recovered);await write(record);
          if(!['listed','sold'].includes(e.phase))throw Error('DESK_EXECUTION_RECEIPT_UNCONFIRMED');
        }
      }
      if(record.status==='active')record.status=settledStatus(record);
      await write(record);report('execution-result',currentPhase,record.status,record);return {record:structuredClone(record),running:false};
    }catch(error){if(record&&begun){if(error.message==='DESK_EXECUTION_NOT_SENT'||error.notSent===true){
        const e=intent;if(e?.phase==='buy-pending'){e.phase='waiting';e.offer=null;}
        else if(e?.phase==='move-pending')e.phase='bought';else if(e?.phase==='list-pending')e.phase=targetHold(record.plan.rows.find(r=>r.definitionId===e.definitionId))?'holding':'transfer';}
      record.status=record.entries.some(e=>pending.has(e.phase))?'recovery-required':'paused';
      record.reason=/^(DESK|FC27)_[A-Z_]+$/.test(error.message)?error.message:'DESK_EXECUTION_UNCONFIRMED';await write(record);report('execution-result',currentPhase,record.status,record,error);return {record,running:false};}throw error;}
    });if(result===null)throw Error('DESK_EXECUTION_BUSY');return result;}
    catch(error){report('execution-result',currentPhase,'blocked',record,error);throw error;}
    finally{adapter?.cancel?.();busy=false;stopped=true;}
  }
  async function recover(){if(busy)throw Error('DESK_EXECUTION_BUSY');busy=true;let adapter,record=null;stage('readonly-recovery');
    try{return await exclusive(scope,async()=>{record=await read();if(!record)return {record:null,running:false};let readConfirmed=false;
      adapter=await createAdapter(record.plan,{canWrite:()=>false,assertCurrent,readOnly:true,onStage:phase=>stage(phase,record),onDiagnostic});
      if(pristine(record)&&record.reason==='DESK_EXECUTION_READ_UNCONFIRMED'){
        stage('funds-capacity',record);await adapter.capabilities();assertCurrent();readConfirmed=true;
      }
      let reviewRequired=false,sourceRevoked=false;
      // Observe pending/listed receipts first, independent of catalyst status.
      // A revoked holding must not hide a separately confirmed native sale.
      for(let i=0;i<record.entries.length;i++){const e=record.entries[i];
        if(!pending.has(e.phase)&&e.phase!=='listed')continue;
        const result=await adapter.reconcile(e,record.plan.rows[i]);assertCurrent();readConfirmed=true;applyReconciliation(e,result);}
      for(let i=0;i<record.entries.length;i++){const e=record.entries[i];if(e.phase!=='holding')continue;
        try{const signal=await adapter.eventExit(e,record.plan.rows[i]);assertCurrent();
          reviewRequired ||= now()>=record.plan.rows[i].event.reviewAt||signal?.reviewRequired===true;
        }catch(error){assertCurrent();if(error.message!=='DESK_EVENT_SOURCE_REVOKED')throw error;sourceRevoked=true;}}
      record.status=settledStatus(record);
      if((reviewRequired||sourceRevoked)&&record.status!=='recovery-required'){record.status='paused';record.reason??=sourceRevoked?'DESK_EVENT_SOURCE_REVOKED':'DESK_EVENT_REVIEW_REQUIRED';}
      if(readConfirmed&&!record.entries.some(e=>pending.has(e.phase)||e.phase==='holding'))record.reason=null;
      await write(record);report('execution-result','readonly-recovery',record.status,record);return {record,running:false};});
    }catch(error){report('execution-result',currentPhase,'blocked',record,error);throw error;}
    finally{adapter?.cancel?.();busy=false;}
  }
  return Object.freeze({inspect,execute,recover,stop(){stopped=true;}});
}
