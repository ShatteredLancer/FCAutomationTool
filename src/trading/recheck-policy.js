const emptyKeys=new Set(['definitionId','phase','offer','reason']);
const settledKeys=new Set([...emptyKeys,'buyAcknowledged','listAcknowledged','listingTradeId','salePrice','soldAt']);
export function noOfferRecheck(record,now){
  if(!record||record.plan.expiresAt<=now)return {reason:'DESK_PLAN_EXPIRED',rows:[]};
  if(record.reason||!['completed','waiting-sales','waiting-events'].includes(record.status)||record.entries.some(e=>
    e.phase==='skipped'?(e.offer!==null||!['DESK_EXECUTION_NO_OFFER','DESK_DISCOVERY_EXPIRED'].includes(e.reason)||Object.keys(e).some(k=>!emptyKeys.has(k)))
      :!['listed','sold','holding','rejected'].includes(e.phase)||Object.keys(e).some(k=>!settledKeys.has(k))))return {reason:'DESK_RECHECK_STOPPED',rows:[]};
  const rows=record.entries.filter(e=>e.phase==='skipped'&&e.reason==='DESK_EXECUTION_NO_OFFER').map(e=>e.definitionId);
  return {reason:rows.length?null:'DESK_RECHECK_NO_CANDIDATES',rows};
}
