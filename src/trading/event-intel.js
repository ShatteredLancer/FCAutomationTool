// Explicit, source-bound event leads. This deliberately does not import or
// extend INTEL_HANDLES, and never establishes EVO eligibility or an order permit.
const MAX_AGE=7*86400000;
const samePost=(a,b)=>a&&b&&a.id===b.id&&a.author.toLowerCase()===b.author.toLowerCase();
export function parseEventPostUrl(input){
  if(typeof input!=='string'||input.length>2048||/[\u0000-\u001f\u007f\\]/.test(input))return null;
  const text=input.trim();
  // Check the raw authority too: URL.port erases an explicitly supplied :443.
  if(!/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9]\d{14,21}\/?(?:[?#].*)?$/i.test(text))return null;
  try{
    const value=new URL(text),match=/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{14,21})\/?$/.exec(value.pathname);
    if(value.protocol!=='https:'||value.username||value.password||value.port||!match
      ||BigInt(match[2])>18446744073709551615n)return null;
    return {url:`https://x.com/${match[1]}/status/${match[2]}`,author:match[1],id:match[2]};
  }catch{return null;}
}

function nativeProof(evidence,root){
  const calls=evidence?.calls;
  if(!Array.isArray(calls)||!calls.length||calls.length>3)throw Error('DESK_INTEL_TRACE_INVALID');
  const safe=[];
  for(const call of calls){
    if(call?.name==='x_thread_fetch'){
      if(typeof call.input?.post_id!=='string'||call.input.post_id!==root.id)throw Error('DESK_INTEL_ROOT_UNVERIFIED');
      safe.push({name:call.name,input:{post_id:root.id}});
    }else if(['x_keyword_search','x_semantic_search'].includes(call?.name)){
      const query=call.input?.query;
      if(typeof query!=='string'||!query.trim()||query.length>512)throw Error('DESK_INTEL_TRACE_INVALID');
      safe.push({name:call.name,input:{query}});
    }else throw Error('DESK_INTEL_NATIVE_X_NOT_USED');
  }
  if(safe.filter(call=>call.name==='x_thread_fetch').length!==1)throw Error('DESK_INTEL_ROOT_UNVERIFIED');
  if(!safe.some(call=>call.name!=='x_thread_fetch'))throw Error('DESK_INTEL_NATIVE_X_NOT_USED');
  // Exact conjunction only. A negated from:, an OR branch or another
  // conversation must not certify unrelated/community replies.
  const checked=safe.some(call=>{
    if(call.name!=='x_keyword_search')return false;
    const tokens=call.input.query.trim().split(/\s+/);
    return tokens.length===2&&tokens.includes(`conversation_id:${root.id}`)
      &&tokens.some(token=>token.toLowerCase()===`from:${root.author.toLowerCase()}`);
  });
  return {search:true,threads:[root.id],authors:checked?[{rootId:root.id,handle:root.author}]:[],calls:safe};
}

const sourceQuote=(text,value)=>{
  if(typeof value!=='string'||!value.length||value.length>180)return null;
  const token=c=>c!=null&&/[\p{L}\p{N}]/u.test(c);let at=-1;
  while((at=text.indexOf(value,at+1))!==-1){const end=at+value.length;
    if(token(value[0])&&token(text[at-1])||token(value.at(-1))&&(token(text[end])||/[.,]/.test(text[end]??'')&&/[0-9٠-٩۰-۹]/.test(text[end+1]??'')))continue;
    return value;
  }return null;
};
const digits=value=>value.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c<='٩'?1632:1776))).replace(/٬/g,',').replace(/٫/g,'.');
const amountPattern='((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?\\s*[kK]?)(?![\\p{L}\\p{N}.,])';
function quotedAmounts(quote,prefix){
  const matches=[...digits(quote).matchAll(new RegExp(`${prefix}\\s*${amountPattern}`,'giu'))];
  return matches.map(match=>{
    const token=match[1].replace(/[,\s]/g,''),[whole,fraction='']=token.replace(/[kK]$/,'').split('.');
    const numerator=BigInt(whole+fraction)*(/[kK]$/.test(token)?1000n:1n),denominator=10n**BigInt(fraction.length);
    if(numerator%denominator!==0n)return null;
    const value=numerator/denominator;
    return value>=150n&&value<=15000000n?Number(value):null;
  });
}
function entryFromSource(raw,text){
  const quote=sourceQuote(text,raw?.quote);if(!quote)return null;
  const strict=quotedAmounts(quote,'(?:<(?!=)|\\b(?:under|below|less\\s+than)\\b|(?:ب?أقل|ب?اقل)\\s+من|تحت|دون)');
  const inclusive=quotedAmounts(quote,'(?:<=|≤|\\b(?:at\\s+most|up\\s+to)\\b|بحد\\s+أقصى|حتى|لا\\s+يزيد\\s+عن)');
  if(strict.length+inclusive.length!==1)return null;
  const ceiling=(strict.length?strict:inclusive)[0],strictBelow=strict.length===1;
  if(ceiling===null||raw.ceiling!==ceiling||raw.strictBelow!==strictBelow)return null;
  return {ceiling,strictBelow,quote};
}
function targetFromSource(raw,text){
  const quote=sourceQuote(text,raw.targetQuote);if(!quote)return {targetPrice:null,targetQuote:null};
  const prices=quotedAmounts(quote,'(?:\\b(?:target(?:\\s+price)?|sell(?:\\s+(?:at|for))?)\\b|الهدف|هدف|البيع|بيع)\\s*(?:(?:is|of)\\s*|[:=]\\s*)?');
  return prices.length===1&&prices[0]!==null&&raw.targetPrice===prices[0]
    ?{targetPrice:prices[0],targetQuote:quote}:{targetPrice:null,targetQuote:null};
}
function namedPlayers(raw,text){
  if(!Array.isArray(raw))return [];
  const players=[],seen=new Set();
  for(const player of raw.slice(0,8)){
    const name=player?.name,quote=sourceQuote(text,player?.nominationQuote);
    if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>100||!quote)continue;
    const start=quote.indexOf(name),word=char=>/[\p{L}\p{N}_]/u.test(char??'');
    if(start<0||word(name[0])&&word(quote[start-1])||word(name.at(-1))&&word(quote[start+name.length]))continue;
    let version=player.version;
    if(typeof version!=='string'||!version.trim()||version.length>100||!quote.includes(version)||/^(?:EA\s*)?FC\s*27$/i.test(version))version=null;
    const identity=`${name}\n${version??''}`;if(seen.has(identity))continue;seen.add(identity);
    players.push({name,version,nominationQuote:quote});
  }
  return players;
}
function postData(raw,post,now){
  const at=typeof raw.publishedAt==='string'?Date.parse(raw.publishedAt):raw.at;
  const snowflake=Number((BigInt(post.id)>>22n)+1288834974657n);
  if(!Number.isSafeInteger(at)||at>now||now-at>MAX_AGE||snowflake>now||now-snowflake>MAX_AGE||Math.abs(snowflake-at)>300000)return null;
  if(typeof raw.text!=='string')return null;
  // Keep a literal source prefix, never rewritten text. Quotes outside this
  // bounded excerpt fail validation, leaving a watch lead rather than a price.
  const text=raw.text.slice(0,1800).replace(/[\uD800-\uDBFF]$/,'');
  if(!text.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)||raw.topic!=='evo')return null;
  return {url:post.url,author:post.author,at,text,topic:raw.topic,players:namedPlayers(raw.players,text),
    entry:entryFromSource(raw.entry,text),...targetFromSource(raw,text),threadChecked:true,threadComplete:false,
    // Partial source hints stay in text; they are never a complete eligibility contract.
    conditions:null};
}

export function normalizeEventIntel(payload,now,evidence,{requestedUrl}={}){
  const root=parseEventPostUrl(requestedUrl);
  if(!root)throw Error('DESK_INTEL_URL_INVALID');
  if(!Number.isSafeInteger(now)||payload?.schema!==1||!Array.isArray(payload.posts)||payload.posts.length>30
    ||payload.error||(payload.requestUrl&&!samePost(parseEventPostUrl(payload.requestUrl),root)))throw Error('DESK_INTEL_RESPONSE_INVALID');
  const nativeEvidence=nativeProof(evidence,root),roots=payload.posts.filter(raw=>samePost(parseEventPostUrl(raw?.url),root));
  if(roots.length!==1)throw Error('DESK_INTEL_ROOT_UNVERIFIED');
  if(roots[0].topic!=='evo')throw Error('DESK_INTEL_POST_NOT_EVO');
  const first=postData(roots[0],root,now);if(!first)throw Error('DESK_INTEL_ROOT_UNVERIFIED');
  const posts=[{...first,evidence:'native-thread-post'}],seen=new Set([root.id]);
  if(nativeEvidence.authors.length)for(const raw of payload.posts){
    const post=parseEventPostUrl(raw?.url),parent=parseEventPostUrl(raw?.parentUrl);
    if(!post||seen.has(post.id)||post.author.toLowerCase()!==root.author.toLowerCase()||BigInt(post.id)<=BigInt(root.id)||!samePost(parent,root))continue;
    const value=postData(raw,post,now);if(!value)continue;seen.add(post.id);
    posts.push({...value,parentUrl:root.url,evidence:'native-thread-author-reply'});if(posts.length===4)break;
  }
  return {schema:1,fetchedAt:now,requestUrl:root.url,posts,nativeEvidence,
    warning:'Explicit source lead only; text is a bounded source excerpt, replies may be missing and EVO conditions remain unknown. Not verified eligibility, market prices, low-risk assurance or trade approval.'};
}
