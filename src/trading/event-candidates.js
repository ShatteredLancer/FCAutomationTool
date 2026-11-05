import {deskFloorPrice,deskNet,deskText} from './desk-model.js';

export const eventStoreKey=scope=>`fcat-fc27-trading-events-v1:${scope}`;
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const clean=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const sourceUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='x.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[A-Za-z0-9_]{1,30}\/status\/\d{15,22}$/.test(u.pathname);}catch{return false;}};
export function readEventStore(raw,context){
  if(!context?.scope||context.season!=='27'||!['console','pc'].includes(context.platform))throw Error('DESK_EVENT_STORAGE_INVALID');
  if(raw==null)return {schema:1,context:structuredClone(context),revision:0,rows:[]};
  if(raw.schema!==1||JSON.stringify(raw.context)!==JSON.stringify(context)||!Array.isArray(raw.rows)||raw.rows.length>6
    ||new globalThis.TextEncoder().encode(JSON.stringify(raw)).length>60000||new Set(raw.rows.map(r=>r.url)).size!==raw.rows.length
    ||raw.rows.filter(r=>r.included).length>3||raw.revision!=null&&!integer(raw.revision))throw Error('DESK_EVENT_STORAGE_INVALID');
  for(const row of raw.rows){const p=row.post;
    if(!sourceUrl(row.url)||p?.url!==row.url||!['leak','failed','live'].includes(row.status)||typeof row.included!=='boolean'
      ||!['target-hold','immediate-target'].includes(row.exitMode)||!integer(row.importedAt)||!integer(p.at)
      ||typeof p.text!=='string'||p.text.length>1800||p.topic!=='evo'||!['native-thread-post','native-thread-author-reply'].includes(p.evidence)
      ||p.threadChecked!==true||!Array.isArray(p.players)||p.players.length>8
      ||p.players.some(v=>typeof v.name!=='string'||v.name.length>100||v.version!=null&&(typeof v.version!=='string'||v.version.length>100)
        ||v.nominationQuote!=null&&(typeof v.nominationQuote!=='string'||v.nominationQuote.length>180))
      ||p.entry!=null&&(!integer(p.entry.ceiling,150,15000000)||typeof p.entry.strictBelow!=='boolean'||typeof p.entry.quote!=='string'||p.entry.quote.length>180||!p.text.includes(p.entry.quote))
      ||p.targetPrice!=null&&(!integer(p.targetPrice,150,15000000)||typeof p.targetQuote!=='string'||p.targetQuote.length>180||!p.text.includes(p.targetQuote)))throw Error('DESK_EVENT_STORAGE_INVALID');
  }
  return {...structuredClone(raw),revision:raw.revision??0};
}
export const eventNames=store=>[...new Set(store.rows.filter(r=>r.status!=='failed').flatMap(r=>r.post.players.filter(p=>p.nominationQuote).map(p=>p.name)))].slice(0,3);
export const eventMatches=(row,player)=>clean(row.mentionQuery)===clean(player.name)||clean(row.name).includes(clean(player.name));
const ceilPrice=n=>{let p=Math.ceil(n);for(let i=0;i<4;i++){const f=deskFloorPrice(p);if(f>=n)return f;p+=p<1000?50:p<10000?100:p<50000?250:p<100000?500:p<1000000?1000:10000;}return null;};
export function eventCandidates(store,pool,references,settings,now){
  const candidates=[],issues=[];
  for(const row of store.rows){const p=row.post,fail=reason=>issues.push({url:row.url,reason,included:row.included});
    if(row.status==='failed'){fail('来源已标记失效，不纳入新方案');continue;}
    if(p.at>now||now-p.at>86400000){fail('线索已超过 24 小时，请重新核对催化剂');continue;}
    const players=p.players.filter(v=>v.nominationQuote&&p.text.toLowerCase().includes(v.nominationQuote.toLowerCase()));
    if(players.length!==1){fail('原帖需明确点名一位候选球员；多名或主题名不自动猜选');continue;}
    const player=players[0];if(player.version&&!/^(?:base|gold|rare gold|common gold|normal|普通|金卡|普通金卡)$/i.test(player.version)){fail('帖子指向特殊或不明确版本，当前只支持唯一普通版本');continue;}
    if(pool.unresolvedNames?.some(n=>clean(n)===clean(player.name))){fail('点名搜索存在同名歧义，不用评分页样本猜选球员');continue;}
    if(!p.entry){fail('原帖未给出可核实的买入上限，保留为线索');continue;}
    const entryQuote=p.entry.quote.trim();if(!entryQuote||/[\u0000-\u001f]/.test(entryQuote)){fail('买入限价引用尚未整理为明确单条条件，保留为线索');continue;}
    const matches=pool.rows.filter(card=>eventMatches(card,player));
    if(matches.length!==1||clean(matches[0].mentionQuery)!==clean(player.name)){fail('尚未唯一匹配普通卡版本，不自动换成其他版本');continue;}const card=matches[0],gg=references?.[card.definitionId]?.quotes?.futgg;
    if(card.season!=='27'||card.platform!==pool.platform||!integer(pool.at)||pool.at>now||!integer(card.price,150,15000000)||!integer(card.fetchedAt)||card.fetchedAt>now||now-card.fetchedAt>=300000
      ||gg?.source!=='futgg'||gg.definitionId!==card.definitionId||gg.season!=='27'||gg.platform!==pool.platform||gg.error
      ||!integer(gg.price,150,15000000)||!integer(gg.fetchedAt)||!integer(gg.expiresAt)||gg.fetchedAt>now||gg.expiresAt<=now||gg.sourceUpdatedAt!=null&&(!integer(gg.sourceUpdatedAt)||gg.sourceUpdatedAt>now||now-gg.sourceUpdatedAt>1800000)
      ||Math.max(card.price,gg.price)/Math.min(card.price,gg.price)>1.15){fail('同平台双源报价缺失、过期或偏差较大，暂不加入交易');continue;}
    const sourceCap=p.entry.ceiling-(p.entry.strictBelow?1:0),buyCeiling=deskFloorPrice(Math.min(sourceCap,card.price,gg.price,settings.unitLimit));
    const target=p.targetPrice??ceilPrice((buyCeiling+settings.minProfit+settings.buffer)*100/95);
    if(!integer(buyCeiling,150,15000000)||!integer(target,150,15000000)||target!==deskFloorPrice(target)||deskNet(target)-buyCeiling<settings.minProfit+settings.buffer){fail('买入上限或来源目标不满足当前利润缓冲');continue;}
    candidates.push({...card,strategy:'evo-event',included:row.included,sourceCount:2,ggPrice:gg.price,ggQuote:structuredClone(gg),buyCeiling,resaleEstimate:target,
      netAtCeiling:deskNet(target)-buyCeiling,requiredDiscount:(1-buyCeiling/card.price)*100,evo:[],
      event:{sourceUrl:row.url,sourceAt:p.at,entryCeiling:p.entry.ceiling,strictBelow:p.entry.strictBelow,entryQuote,
        exitMode:row.exitMode,reviewAt:now+21600000,targetBasis:p.targetPrice==null?'required-return':'source',status:'leak',evidence:'native-thread-post'},
      reason:deskText(`EVO 消息仓，完整条件待核实；来源买价${p.entry.strictBelow?'<':'≤'}${p.entry.ceiling}；${p.targetPrice==null?'卖出目标只按税后利润和缓冲测算，不是预测':'卖出目标来自帖子，不是成交保证'}；6 小时后复核，不自动亏本卖出`,400)});
  }
  return {candidates,issues,at:now,validUntil:Math.min(pool.at+300000,...candidates.map(c=>c.ggQuote.expiresAt))};
}
