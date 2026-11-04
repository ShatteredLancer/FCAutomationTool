// Public search evidence only. Never an eligibility proof or an order permit.
export const INTEL_HANDLES=Object.freeze(['FutSheriff','FutPoliceLeaks','Fut_scoreboard','AsyFutTrader','DetectiveFUT']);
const name=s=>String(s??'').trim().slice(0,100);
export function intelPostUrl(input){
  try{const u=new URL(input),m=/^\/([A-Za-z0-9_]{1,30})\/status\/(\d{15,22})\/?$/.exec(u.pathname);
    if(u.protocol!=='https:'||!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)||u.username||u.password||!m
      ||!INTEL_HANDLES.some(h=>h.toLowerCase()===m[1].toLowerCase()))return null;
    return {url:`https://x.com/${m[1]}/status/${m[2]}`,author:m[1],id:m[2]};
  }catch{return null;}
}
export function normalizeTradingIntel(value,now,evidence=null){
  if(value?.schema!==1||!Array.isArray(value.posts)||value.posts.length>30)throw Error('DESK_INTEL_RESPONSE_INVALID');
  const calls=evidence?.calls??[],search=calls.some(c=>['x_keyword_search','x_semantic_search'].includes(c.name))||evidence?.search===true;
  const threads=[...new Set([...(evidence?.threads??[]),...calls.filter(c=>c.name==='x_thread_fetch').map(c=>c.input?.post_id)])]
    .filter(id=>/^\d{15,22}$/.test(String(id))).map(String).slice(0,6);
  const authors=[...(evidence?.authors??[]),...calls.filter(c=>c.name==='x_keyword_search').flatMap(c=>{
    const query=c.input?.query??'',root=/\bconversation_id:(\d{15,22})\b/.exec(query),author=/\bfrom:([A-Za-z0-9_]{1,30})\b/.exec(query);
    return root&&author?[{rootId:root[1],handle:author[1]}]:[];
  })].filter(a=>/^\d{15,22}$/.test(a?.rootId??'')&&INTEL_HANDLES.some(h=>h.toLowerCase()===String(a.handle).toLowerCase())).slice(0,6);
  const posts=[],seen=new Set(),fingerprints=new Set();
  for(const raw of value.posts){
    const post=intelPostUrl(raw.url),parent=raw.parentUrl?intelPostUrl(raw.parentUrl):null,at=Date.parse(raw.publishedAt);
    if(!post||seen.has(post.id)||!Number.isSafeInteger(at)||at>now||now-at>7*86400000)continue;
    // A generated date must also agree with the original X snowflake. Reject
    // stale IDs relabelled as today's news and future/ambiguous timestamps.
    const snowflake=Number((BigInt(post.id)>>22n)+1288834974657n);
    if(Math.abs(snowflake-at)>300000)continue;
    const text=String(raw.text??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,1800);
    if(!text||!['evo','sbc','meta'].includes(raw.topic))continue;
    const key=text.toLowerCase().replace(/https?:\/\/\S+|[^\p{L}\p{N}]/gu,'').slice(0,300);
    if(fingerprints.has(key))continue;fingerprints.add(key);seen.add(post.id);
    const authorReply=parent&&parent.author.toLowerCase()===post.author.toLowerCase()&&BigInt(parent.id)<BigInt(post.id);
    const checkedReply=authorReply&&search&&threads.includes(parent.id)&&authors.some(a=>a.rootId===parent.id&&a.handle.toLowerCase()===post.author.toLowerCase());
    const clean=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const players=Array.isArray(raw.players)?raw.players.slice(0,8).filter(p=>name(p?.name)).map(p=>{
      const quote=String(p.nominationQuote??'').trim().slice(0,180),n=name(p.name),v=name(p.version);
      const nominated=quote&&text.toLowerCase().includes(quote.toLowerCase())&&clean(quote).includes(clean(n));
      return {name:n,version:/^(?:EA\s*)?FC\s*27$/i.test(v)?null:v||null,nominationQuote:nominated?quote:null};
    }):[];
    const maxRating=raw.conditions?.maxRating,positions=raw.conditions?.positions;
    const evo=raw.topic==='evo'&&Number.isSafeInteger(maxRating)&&maxRating>=1&&maxRating<=99?{maxRating,
      positions:Array.isArray(positions)?positions.filter(p=>['GK','CB','LB','RB','LWB','RWB','CDM','CM','CAM','LM','RM','LW','RW','ST','CF'].includes(p)).slice(0,5):[]}:null;
    posts.push({url:post.url,author:post.author,at,text,topic:raw.topic,players,parentUrl:authorReply&&(!search||checkedReply)?parent.url:null,
      evidence:search?(checkedReply?'native-thread-author-reply':'native-search-post'):(authorReply?'search-reported-author-reply':'search-reported-post'),
      threadChecked:checkedReply||search&&threads.includes(post.id),threadComplete:false,evo});
  }
  return {schema:1,posts:posts.sort((a,b)=>b.at-a.at),fetchedAt:now,provider:search?'grok-native-x':'grok-public-search',realTime:false,
    ...(search?{nativeEvidence:{search,threads,authors}}:{}),
    warning:search?'已调用原生 X 搜索；已标注线程核对和作者回复。结果可能漏帖/漏回复，未保证全量线程；爆料仍非官方确认'
      :'公开搜索可能延迟、漏帖或漏回复；作者回复关联来自搜索结果，未核完整线程；爆料不是已上线事实'};
}
export function intelEvents(feed){
  return (feed?.posts??[]).filter(p=>p.topic==='evo').map(post=>({url:post.url,note:post.text.slice(0,300),at:post.at,status:'leak',
    ...(post.evo?{evo:post.evo}:{}),players:post.players.filter(p=>p.nominationQuote),evidence:post.evidence}));
}
