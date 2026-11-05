import {describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseEventPostUrl,normalizeEventIntel} from '../../src/trading/event-intel.js';
import {INTEL_HANDLES,intelPostUrl} from '../../src/trading/intel.js';
import {createFc27TradingIntel} from '../../src/adapters/browser/fc27-trading-intel.js';
import {collectTradingIntel,intelPrompt} from '../../scripts/trading-intel/collector.mjs';
import {createTradingIntelServer,startTradingIntelServer} from '../../scripts/trading-intel/server.mjs';

// Entirely synthetic: no paid/model requests and no EA operations.
const now=Date.parse('2026-11-05T08:00:00Z'),day=86400000;
const snowflake=at=>String((BigInt(at)-1288834974657n)<<22n);
const rootId=snowflake(now-60000),url=`https://x.com/FlipX_1/status/${rootId}`,key='a'.repeat(48);
it('fails closed before real process spawning in a test environment, even when startup injection is missing',async()=>{
  await expect(collectTradingIntel({executable:'FCAT-TEST-INVALID-NO-MODEL',cwd:os.tmpdir(),env:{NODE_ENV:'test'},postUrl:url,timeoutMs:50})).rejects.toThrow('DESK_INTEL_TEST_LIVE_DISABLED');
});
const source='استثمار EVO: Camavinga اشترِ بأقل من 1.5K. الشروط غير كاملة.';
const root=(extra={})=>({url,publishedAt:new Date(now-60000).toISOString(),text:source,topic:'evo',
  players:[{name:'Camavinga',version:null,nominationQuote:'Camavinga اشترِ بأقل من 1.5K'}],
  entry:{ceiling:1500,strictBelow:true,quote:'اشترِ بأقل من 1.5K'},targetPrice:null,targetQuote:null,...extra});
const payload=(posts=[root()])=>({schema:1,posts});
const trace=(author='FlipX_1',id=rootId)=>({calls:[{name:'x_thread_fetch',input:{post_id:id}},
  {name:'x_keyword_search',input:{query:`conversation_id:${id} from:${author}`}}]});
const normalized=()=>normalizeEventIntel(payload(),now,trace(),{requestedUrl:url});
const reply=(delta=10000,extra={})=>root({url:`https://x.com/FlipX_1/status/${snowflake(now-60000+delta)}`,
  publishedAt:new Date(now-60000+delta).toISOString(),parentUrl:url,text:`Camavinga reply ${delta}`,
  players:[],entry:null,...extra});
const normalize=(value,evidence=trace(),requestedUrl=url)=>normalizeEventIntel(value,now,evidence,{requestedUrl});
it('does not accept a truncated source quote that changes the original numeric target',()=>{
  const value=normalize(payload([root({text:source+' target 2000K',targetPrice:2000,targetQuote:'target 2000'})]));
  expect(value.posts[0].targetPrice).toBeNull();
});

describe('explicit X URL boundary (not global source enrollment)',()=>{
  it('canonicalizes any valid author without changing the original five refresh handles',()=>{
    expect(parseEventPostUrl(` https://www.twitter.com/Other_Author/status/${rootId}?s=20#context `))
      .toEqual({url:`https://x.com/Other_Author/status/${rootId}`,author:'Other_Author',id:rootId});
    expect(INTEL_HANDLES).toEqual(['FutSheriff','FutPoliceLeaks','Fut_scoreboard','AsyFutTrader','DetectiveFUT']);
    expect(intelPostUrl(url)).toBeNull();expect(intelPrompt(now)).not.toContain('FlipX_1');
  });
  it.each([
    `http://x.com/FlipX_1/status/${rootId}`,`https://x.com:443/FlipX_1/status/${rootId}`,
    `https://x.com:123/FlipX_1/status/${rootId}`,`https://user@x.com/FlipX_1/status/${rootId}`,
    `https://:pass@x.com/FlipX_1/status/${rootId}`,`https://x.com.evil/FlipX_1/status/${rootId}`,
    `https://evil/x.com/FlipX_1/status/${rootId}`,`https://x.com/Flip-X/status/${rootId}`,
    `https://x.com/abcdefghijklmnop/status/${rootId}`,`https://x.com/FlipX_1/status/${rootId}/photo/1`,
    `https://x.com/FlipX_1/status/0${rootId}`,`https://x.com/i/status/${rootId}/extra`,
    `https://x.com\\@evil/FlipX_1/status/${rootId}`,`https://x.com/FlipX_1/status/${rootId}\n?foo`,null,{},
    `https://x.com/Other/../FlipX_1/status/${rootId}`,`https://x.com/Other/%2e%2e/FlipX_1/status/${rootId}`,
  ])('rejects non-status, credentialed, port-bearing or malformed input: %s',input=>{
    expect(parseEventPostUrl(input)).toBeNull();
  });
});

describe('source-bound event schema',()=>{
  it('keeps the exact root, Arabic source text and deterministic entry, with unknown EVO conditions',()=>{
    const value=normalize(payload([root({confidence:1,lowRisk:true,conditions:{maxRating:82}})]));
    expect(value).toMatchObject({schema:1,fetchedAt:now,requestUrl:url,nativeEvidence:{search:true},posts:[{
      url,author:'FlipX_1',at:now-60000,text:source,topic:'evo',entry:{ceiling:1500,strictBelow:true,quote:'اشترِ بأقل من 1.5K'},
      players:[{name:'Camavinga',version:null,nominationQuote:'Camavinga اشترِ بأقل من 1.5K'}],
      targetPrice:null,targetQuote:null,evidence:'native-thread-post',threadChecked:true,threadComplete:false,conditions:null,
    }]});
    expect(JSON.stringify(value)).not.toMatch(/confidence|lowRisk/);expect(value.warning).toBeTruthy();
    expect(normalize(value,value.nativeEvidence)).toEqual(value);
  });
  it('accepts a different explicit publisher but never changes refresh eligibility',()=>{
    const requested=url.replace('FlipX_1','AnotherAuthor');
    expect(normalize(payload([root({url:requested})]),trace('AnotherAuthor'),requested).posts[0].author).toBe('AnotherAuthor');
    expect(intelPostUrl(requested)).toBeNull();
  });
  it('conforms to store limits and preserves a root watch lead without an entry or nomination',()=>{
    const quote='Camavinga '+'x'.repeat(181),text=quote+' '+'z'.repeat(2000);
    const value=normalize(payload([root({text,players:[{name:'Camavinga',nominationQuote:quote}],
      entry:{ceiling:1500,strictBelow:true,quote},targetPrice:2000,targetQuote:quote})]));
    expect(value.posts).toHaveLength(1);expect(value.posts[0]).toMatchObject({url,topic:'evo',evidence:'native-thread-post',
      players:[],entry:null,targetPrice:null,targetQuote:null,conditions:null,threadComplete:false});
    expect(value.posts[0].text).toBe(text.slice(0,1800));
  });
  it('keeps unknown source prices null instead of passing out-of-range values into event storage',()=>{
    for(const price of [149,15000001]){
      const quote=`buy under ${price}`,targetQuote=`target ${price}`;
      expect(normalize(payload([root({text:`${quote}; ${targetQuote}`,entry:{ceiling:price,strictBelow:true,quote},targetPrice:price,targetQuote})])).posts[0])
        .toMatchObject({entry:null,targetPrice:null,targetQuote:null});
    }
  });
  it.each(['sbc','meta','other'])('does not silently relabel a non-EVO root as EVO: %s',topic=>{
    expect(()=>normalize(payload([root({topic})]))).toThrow('DESK_INTEL_POST_NOT_EVO');
  });
  it.each([
    payload([]),payload([root({url:url.replace('FlipX_1','Impersonator')})]),
    payload([root({url:`https://x.com/FlipX_1/status/${snowflake(now-50000)}`})]),
    payload([root({publishedAt:new Date(now-600000).toISOString()})]),
    payload([root({publishedAt:'unknown'})]),payload([root({text:''})]),
    {schema:2,posts:[root()]},payload([root(),root()]),
  ])('rejects a missing, substituted, conflicting or unverified root',value=>{
    expect(()=>normalize(value)).toThrow(/DESK_INTEL_/);
  });
  it('rejects stale/future snowflakes even when supplied publication time looks recent',()=>{
    for(const at of [now-8*day,now+1000]){
      const id=snowflake(at),requested=`https://x.com/FlipX_1/status/${id}`;
      expect(()=>normalize(payload([root({url:requested,publishedAt:new Date(at).toISOString()})]),trace('FlipX_1',id),requested)).toThrow();
    }
  });
  it.each([
    null,{search:true,threads:[rootId],authors:[{rootId,handle:'FlipX_1'}]},
    {calls:[{name:'web_search',input:{query:'x_thread_fetch'}}]},
    {calls:[trace().calls[0]]},{calls:[trace().calls[1]]},
    {calls:[{name:'x_thread_fetch',input:{post_id:snowflake(now-50000)}},trace().calls[1]]},
    {calls:[...trace().calls,trace().calls[0]]},
    {calls:[...trace().calls,trace().calls[1],trace().calls[1]]},
  ])('requires actual bounded native root fetch and search calls, never generated assertions',evidence=>{
    expect(()=>normalize(payload(),evidence)).toThrow(/DESK_INTEL_/);
  });
  it('keeps root first and at most three verified same-author conversation replies',()=>{
    const posts=[reply(40000),reply(),root(),reply(20000),reply(30000),reply(10000),
      reply(5000,{url:reply(5000).url.replace('FlipX_1','Other')}),reply(6000,{parentUrl:null}),
      reply(7000,{parentUrl:url.replace('FlipX_1','Other')})];
    const value=normalize(payload(posts));expect(value.posts).toHaveLength(4);expect(value.posts[0].url).toBe(url);
    for(const post of value.posts.slice(1))expect(post).toMatchObject({author:'FlipX_1',parentUrl:url,evidence:'native-thread-author-reply',threadChecked:true,threadComplete:false});
  });
  it('preserves a watch root and the actual nominated reply URL for downstream importEvent selection',()=>{
    const followup=reply(10000,{text:'Camavinga buy under 1.5K',players:[{name:'Camavinga',version:null,nominationQuote:'Camavinga buy under 1.5K'}],
      entry:{ceiling:1500,strictBelow:true,quote:'buy under 1.5K'}});
    const value=normalize(payload([root({entry:null,players:[]}),followup]));
    expect(value.posts[0]).toMatchObject({url,entry:null,players:[]});
    expect(value.posts[1]).toMatchObject({url:followup.url,parentUrl:url,players:[{name:'Camavinga'}],entry:{ceiling:1500}});
    expect(normalize(value,value.nativeEvidence)).toEqual(value);
  });
  it.each([
    'from:Other',`conversation_id:${rootId} from:Other`,`conversation_id:${rootId} -from:FlipX_1`,
    `conversation_id:${rootId} from:FlipX_1 OR from:Other`,`conversation_id:${snowflake(now-50000)} from:FlipX_1`,
  ])('discards replies without an exact author-filtered conversation search: %s',query=>{
    expect(normalize(payload([root(),reply()]),{calls:[trace().calls[0],{name:'x_keyword_search',input:{query}}]}).posts).toHaveLength(1);
  });
  it('drops image guesses, invented nominations/versions and case-altered quotes',()=>{
    const players=[{name:'Mbappe',nominationQuote:'Mbappe fits the image'},
      {name:'Camavinga',version:'TOTW',nominationQuote:'Camavinga اشترِ بأقل من 1.5K'},
      {name:'Camavinga',version:'FC27',nominationQuote:'Camavinga اشترِ بأقل من 1.5K'},
      {name:'Camavinga',nominationQuote:'camavinga اشترِ بأقل من 1.5K'}];
    const value=normalize(payload([root({players,image:'Mbappe TOTW',eligibility:true})]));
    expect(value.posts[0].players).toEqual([{name:'Camavinga',version:null,nominationQuote:'Camavinga اشترِ بأقل من 1.5K'}]);
    expect(value.posts[0]).not.toHaveProperty('eligibility');
  });
  it('does not promote a substring of a name or another sentence\'s version to a nominated card',()=>{
    const value=normalize(payload([root({text:source+' Mbappe TOTW.',players:[
      {name:'Cam',nominationQuote:'Camavinga اشترِ بأقل من 1.5K'},
      {name:'Camavinga',version:'TOTW',nominationQuote:'Camavinga اشترِ بأقل من 1.5K'},
    ]})]));
    expect(value.posts[0].players).toEqual([{name:'Camavinga',version:null,nominationQuote:'Camavinga اشترِ بأقل من 1.5K'}]);
  });
  it('parses upper-case source grammar and decimal K amounts without floating-point rounding',()=>{
    for(const [quote,ceiling] of [['BUY UNDER 1.001K',1001],['buy under 8.001K',8001]])
      expect(normalize(payload([root({text:quote,entry:{ceiling,strictBelow:true,quote}})])).posts[0].entry?.ceiling).toBe(ceiling);
  });
  it.each(['1500','1.5K','1,500','١٥٠٠','۱٬۵۰۰','١٫٥K'])('validates numeric entry from the exact quote: %s',amount=>{
    const quote=`buy under ${amount}`,value=normalize(payload([root({text:`Camavinga: ${quote}`,players:[],entry:{ceiling:1500,strictBelow:true,quote}})]));
    expect(value.posts[0].entry).toEqual({ceiling:1500,strictBelow:true,quote});
  });
  it.each([
    {text:'buy under 1500',entry:{ceiling:1600,strictBelow:true,quote:'buy under 1500'}},
    {text:'buy under 1500',entry:{ceiling:1500,strictBelow:false,quote:'buy under 1500'}},
    {text:'buy under 1500',entry:{ceiling:1500,strictBelow:true,quote:'BUY under 1500'}},
    {text:'rating 82, target 1500',entry:{ceiling:1500,strictBelow:true,quote:'rating 82, target 1500'}},
    {text:'buy under 1500 or buy under 2000',entry:{ceiling:1500,strictBelow:true,quote:'buy under 1500 or buy under 2000'}},
    {text:'buy under 1.5',entry:{ceiling:1.5,strictBelow:true,quote:'buy under 1.5'}},
    {text:'buy under 1,50',entry:{ceiling:150,strictBelow:true,quote:'buy under 1,50'}},
  ])('does not invent, round or reinterpret an entry price',extra=>{
    expect(normalize(payload([root(extra)])).posts[0].entry).toBeNull();
  });
  it('preserves inclusive limits and only independently quoted numeric targets',()=>{
    const value=normalize(payload([root({text:'Camavinga buy at most 1500; target 2K',
      entry:{ceiling:1500,strictBelow:false,quote:'buy at most 1500'},targetPrice:2000,targetQuote:'target 2K'})]));
    expect(value.posts[0]).toMatchObject({entry:{ceiling:1500,strictBelow:false},targetPrice:2000,targetQuote:'target 2K'});
    for(const extra of [{targetPrice:2500,targetQuote:'target 2K'},{targetPrice:2000,targetQuote:'target 2K'},{targetPrice:2000,targetQuote:null}])
      expect(normalize(payload([root(extra)])).posts[0]).toMatchObject({targetPrice:null,targetQuote:null});
  });
});

function fakeSpawn(value=payload(),extra={}){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=vi.fn();
  const spawnProcess=vi.fn(()=>{queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({stopReason:'end_turn',sessionId:'12345678-1234-1234-1234-123456789012',text:JSON.stringify(value),...extra})));child.emit('close',0);});return child;});
  return {child,spawnProcess};
}
describe('isolated single-post collector',()=>{
  it('uses a dedicated canonical single-root prompt and the existing isolated sandbox/trace path',async()=>{
    const {spawnProcess}=fakeSpawn(),readEvidence=vi.fn(async()=>trace());
    const value=await collectTradingIntel({executable:'FIXTURE',cwd:'ISOLATED_FIXTURE',spawnProcess,readEvidence,now:()=>now,postUrl:url+'?s=20'});
    expect(value.posts).toHaveLength(1);expect(value.requestUrl).toBe(url);
    const [,args,options]=spawnProcess.mock.calls[0],prompt=args[args.indexOf('--single')+1];
    expect(prompt).toContain(url);expect(prompt).not.toContain('?s=20');expect(prompt).toContain('conversation_id:');
    expect(prompt).toContain('at most 3');expect(prompt).not.toContain(INTEL_HANDLES.join(', '));
    expect(args).toContain('--no-subagents');expect(args).not.toContain('--tools');expect(args).toContain('MCPTool');
    expect(options).toMatchObject({cwd:'ISOLATED_FIXTURE',shell:false,windowsHide:true,env:{GROK_MEMORY:'0'}});
    expect(readEvidence).toHaveBeenCalledWith(expect.objectContaining({cwd:'ISOLATED_FIXTURE',sessionId:'12345678-1234-1234-1234-123456789012'}));
  });
  it('rejects malformed explicit URLs before spawning, and missing root traces after spawning',async()=>{
    const {spawnProcess}=fakeSpawn();
    await expect(collectTradingIntel({executable:'FIXTURE',cwd:'FIXTURE',spawnProcess,postUrl:'https://evil/status/123'})).rejects.toThrow('URL_INVALID');
    expect(spawnProcess).not.toHaveBeenCalled();
    await expect(collectTradingIntel({executable:'FIXTURE',cwd:'FIXTURE',spawnProcess,postUrl:url,now:()=>now,
      readEvidence:async()=>({calls:[trace().calls[1]]})})).rejects.toThrow(/DESK_INTEL_/);
  });
  it('cancels and times out only its owned synthetic child, with no trace read',async()=>{
    for(const cancel of [true,false]){
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=vi.fn();
      const controller=new AbortController(),readEvidence=vi.fn();
      const result=collectTradingIntel({executable:'FIXTURE',cwd:'FIXTURE',postUrl:url,spawnProcess:()=>child,readEvidence,signal:controller.signal,timeoutMs:10});
      const check=expect(result).rejects.toThrow(cancel?'STOPPED':'TIMEOUT');if(cancel)controller.abort();await check;
      expect(child.kill).toHaveBeenCalledOnce();expect(readEvidence).not.toHaveBeenCalled();
    }
  });
});

const request=(base,route='post',body={url},secret=key)=>fetch(`${base}/v1/${route}`,{
  method:'POST',headers:{'X-FCAT-Intel-Key':secret,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
async function withServer(options,task){
  const server=createTradingIntelServer({key,...options});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await task(`http://127.0.0.1:${server.address().port}`,server);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
describe('authenticated HTTP job ownership, quotas and bounded caching',()=>{
  it('sends only a canonical URL and the owned abort signal to collectPost, not to refresh',async()=>{
    const collect=vi.fn(),collectPost=vi.fn(async()=>normalized());
    await withServer({collect,collectPost,now:()=>now},async base=>{
      expect((await request(base,'post',{url},'wrong')).status).toBe(401);
      expect((await request(base,'post',{url:url+'?s=20'})).status).toBe(200);
      expect(collectPost).toHaveBeenCalledOnce();expect(collectPost.mock.calls[0][0]).toEqual({url,signal:expect.any(AbortSignal)});
      expect(collect).not.toHaveBeenCalled();
    });
  });
  it.each([{},[],null,{url,account:'private'},{url,prompt:'instructions'},{url:12},{url:'http://x.com/a/status/123'},'{',
    JSON.stringify({url:'x'.repeat(1020)})])('rejects invalid or oversized bodies before doing model work: %s',async body=>{
    const collectPost=vi.fn();await withServer({collect:vi.fn(),collectPost},async base=>{
      const result=await request(base,'post',body);expect([400,413]).toContain(result.status);expect(collectPost).not.toHaveBeenCalled();
    });
  });
  it('enforces the body cap in bytes including chunked UTF-8 input',async()=>{
    const collectPost=vi.fn();await withServer({collect:vi.fn(),collectPost},async base=>{
      const status=await new Promise((resolve,reject)=>{
        const req=http.request(base+'/v1/post',{method:'POST',headers:{'X-FCAT-Intel-Key':key,'Transfer-Encoding':'chunked'}},res=>{res.resume();resolve(res.statusCode);});
        req.once('error',reject);req.write('{"url":"');req.write('你'.repeat(400));req.end('"}');
      });
      expect(status).toBe(413);expect(collectPost).not.toHaveBeenCalled();
    });
  });
  it('times out an authenticated unfinished body without owning a job or consuming quota',async()=>{
    const collect=vi.fn(),collectPost=vi.fn();
    await withServer({collect,collectPost,now:()=>now,maxRuns:0},async base=>{
      const value=await new Promise((resolve,reject)=>{
        const req=http.request(base+'/v1/post',{method:'POST',headers:{'X-FCAT-Intel-Key':key,'Transfer-Encoding':'chunked'}},res=>{
          let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{resolve({status:res.statusCode,text,connection:res.headers.connection});req.destroy();});
        });
        req.once('error',reject);req.write('{"url":');
      });
      expect(value).toMatchObject({status:408,connection:'close'});expect(JSON.parse(value.text).error).toBe('DESK_INTEL_REQUEST_TIMEOUT');
      expect((await request(base,'status',{})).status).toBe(200);expect((await request(base)).status).toBe(429);
      expect(collectPost).not.toHaveBeenCalled();expect(collect).not.toHaveBeenCalled();
    });
  });
  it.each(['post','refresh'])('caps %s JSON responses at 100 KB UTF-8 and never caches an oversized result',async route=>{
    const collect=vi.fn(async()=>({...normalized(),padding:'你'.repeat(34000)}));
    await withServer({collect,collectPost:collect,now:()=>now},async base=>{
      const result=await request(base,route,route==='post'?{url}:{}),text=await result.text();
      expect(result.status).toBe(503);expect(Buffer.byteLength(text)).toBeLessThanOrEqual(100000);
      expect(JSON.parse(text).error).toBe('DESK_INTEL_RESPONSE_LIMIT');
      expect((await request(base,route,route==='post'?{url}:{})).status).toBe(429);expect(collect).toHaveBeenCalledOnce();
    });
  });
  it('coalesces concurrent canonical aliases and rejects different imports/refresh while busy',async()=>{
    let release,entered;const started=new Promise(resolve=>entered=resolve);
    const collect=vi.fn(),collectPost=vi.fn(()=>{entered();return new Promise(resolve=>release=resolve);});
    await withServer({collect,collectPost,now:()=>now},async base=>{
      const first=request(base);await started;const same=request(base,'post',{url:url.replace('x.com','twitter.com')+'?s=20'});
      expect((await request(base,'post',{url:url.replace('FlipX_1','Other')})).status).toBe(409);
      expect((await request(base,'refresh',{})).status).toBe(409);
      expect((await(await request(base,'status',{})).json()).collecting).toBe(true);
      release(normalized());expect((await first).status).toBe(200);expect((await same).status).toBe(200);
      expect(collectPost).toHaveBeenCalledOnce();expect(collect).not.toHaveBeenCalled();
    });
  });
  it('rejects an import while a refresh job owns the collector',async()=>{
    let release,entered;const started=new Promise(resolve=>entered=resolve),collectPost=vi.fn();
    await withServer({collect:()=>{entered();return new Promise(resolve=>release=resolve);},collectPost,now:()=>now},async base=>{
      const first=request(base,'refresh',{});await started;
      expect((await request(base)).status).toBe(409);expect(collectPost).not.toHaveBeenCalled();release({schema:1,posts:[],fetchedAt:now});await first;
    });
  });
  it('shares daily quota and error backoff across refresh/import without charging cache or status',async()=>{
    let clock=now;const collect=vi.fn(async()=>({schema:1,posts:[],fetchedAt:clock})),collectPost=vi.fn(async()=>normalized());
    await withServer({collect,collectPost,now:()=>clock,maxRuns:2},async base=>{
      expect((await request(base,'status',{})).status).toBe(200);expect((await request(base)).status).toBe(200);
      expect((await(await request(base)).json()).cached).toBe(true);expect((await request(base,'refresh',{})).status).toBe(200);
      expect((await request(base,'post',{url:url.replace('FlipX_1','Other')})).status).toBe(429);
      clock+=day;expect((await request(base)).status).toBe(200);expect(collectPost).toHaveBeenCalledTimes(2);
    });
    collectPost.mockImplementation(async()=>{throw Error('DESK_INTEL_TIMEOUT');});
    await withServer({collect,collectPost,now:()=>clock},async base=>{
      expect((await request(base)).status).toBe(503);expect((await request(base,'refresh',{})).status).toBe(429);
      clock+=60001;expect((await request(base,'refresh',{})).status).toBe(200);
    });
  });
  it('caps at 24 paid jobs per UTC day even if configured higher',async()=>{
    let clock=now;const collectPost=vi.fn(async()=>normalized());
    await withServer({collect:vi.fn(),collectPost,now:()=>clock,maxRuns:100},async base=>{
      for(let i=0;i<24;i++){expect((await request(base)).status).toBe(200);clock+=900001;}
      expect((await request(base)).status).toBe(429);expect(collectPost).toHaveBeenCalledTimes(24);
    });
  });
  it('bounds the single-URL cache to five entries and expires them after 15 minutes',async()=>{
    let clock=now;const collectPost=vi.fn(async()=>normalized());
    await withServer({collect:vi.fn(),collectPost,now:()=>clock},async base=>{
      for(let i=0;i<6;i++)expect((await request(base,'post',{url:url.replace('FlipX_1',`Author${i}`)})).status).toBe(200);
      expect((await(await request(base,'post',{url:url.replace('FlipX_1','Author5')})).json()).cached).toBe(true);
      await request(base,'post',{url:url.replace('FlipX_1','Author0')});expect(collectPost).toHaveBeenCalledTimes(7);
      clock+=900001;await request(base,'post',{url:url.replace('FlipX_1','Author0')});expect(collectPost).toHaveBeenCalledTimes(8);
    });
  });
  it('shutdown aborts the owned import and does not itself consume a model call',async()=>{
    let entered;const started=new Promise(resolve=>entered=resolve),aborted=vi.fn(),collect=vi.fn();
    const collectPost=vi.fn(({signal})=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>{aborted();reject(Error('DESK_INTEL_STOPPED'));},{once:true});entered();
    }));
    await withServer({collect,collectPost},async(base,server)=>{
      const pending=request(base);await started;const closed=new Promise(resolve=>server.once('close',resolve));
      expect((await request(base,'shutdown',{})).status).toBe(200);expect((await(await pending).json()).error).toBe('DESK_INTEL_STOPPED');await closed;
      expect(aborted).toHaveBeenCalledOnce();expect(collectPost).toHaveBeenCalledOnce();expect(collect).not.toHaveBeenCalled();
    });
  });
  it('startup wires both jobs through isolated collector workspaces and never prints the pairing key',async()=>{
    // Fail closed even while testing a broken/missing injection seam.
    vi.stubEnv('FCAT_GROK_EXE',path.join(os.tmpdir(),'FCAT_SYNTHETIC_NONEXISTENT_GROK.exe'));
    vi.stubEnv('FCAT_INTEL_PROXY','http://127.0.0.1:1');
    const directory=await mkdtemp(path.join(os.tmpdir(),'fcat-event-start-'));
    const collectIntel=vi.fn(options=>{
      const author=parseEventPostUrl(options.postUrl)?.author??'FlipX_1';
      const {spawnProcess}=fakeSpawn(payload([root({url:options.postUrl??url})]));
      return collectTradingIntel({...options,spawnProcess,now:()=>now,readEvidence:async()=>trace(author)});
    });
    const log=vi.spyOn(console,'log').mockImplementation(()=>{});let server;
    try{
      server=await startTradingIntelServer({directory,port:0,collectIntel});
      const pairing=(await readFile(path.join(directory,'pairing-key'),'utf8')).trim(),base=`http://127.0.0.1:${server.address().port}`;
      expect(log.mock.calls.flat().join('\n')).not.toContain(pairing);expect(collectIntel).not.toHaveBeenCalled();
      expect((await request(base,'status',{},pairing)).status).toBe(200);expect(collectIntel).not.toHaveBeenCalled();
      expect((await request(base,'post',{url},pairing)).status).toBe(200);
      expect((await request(base,'post',{url:url.replace('FlipX_1','Other')},pairing)).status).toBe(200);
      expect((await request(base,'refresh',{},pairing)).status).toBe(200);
      const options=collectIntel.mock.calls.map(call=>call[0]);
      expect(options).toHaveLength(3);expect(options[0].postUrl).toBe(url);expect(options[2]).not.toHaveProperty('postUrl');
      expect(new Set(options.map(value=>value.cwd)).size).toBe(3);
      for(const value of options){expect(value.cwd.startsWith(os.tmpdir())).toBe(true);expect(value.cwd).not.toContain(path.resolve('src'));expect(value.signal).toBeInstanceOf(AbortSignal);}
    }finally{log.mockRestore();vi.unstubAllEnvs();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
  });
});

describe('GM single-post transport',()=>{
  const browser=gmRequest=>createFc27TradingIntel({gmRequest,get:async()=>key,set:vi.fn(),now:()=>now});
  it('posts only the canonical URL, authenticates and revalidates the event schema',async()=>{
    const gm=vi.fn(options=>options.onload({status:200,responseText:JSON.stringify(normalized())}));
    const value=await browser(gm).importPost({url:url+'?s=20',inventory:['private'],prompt:'ignored'});
    expect(value.posts[0].entry.ceiling).toBe(1500);
    expect(gm.mock.calls[0][0]).toMatchObject({method:'POST',url:'http://127.0.0.1:17864/v1/post',timeout:185000,
      data:JSON.stringify({url}),headers:{'X-FCAT-Intel-Key':key}});
  });
  it('does not probe or collect for invalid input or missing pairing',async()=>{
    const gm=vi.fn();await expect(browser(gm).importPost({url:'https://evil'})).rejects.toThrow('URL_INVALID');expect(gm).not.toHaveBeenCalled();
    await expect(createFc27TradingIntel({gmRequest:gm,get:async()=>'',set:vi.fn()}).importPost({url})).rejects.toThrow('PAIRING');expect(gm).not.toHaveBeenCalled();
  });
  it('reports that a legacy collector needs restarting, including non-JSON 404 responses',async()=>{
    await expect(browser(o=>o.onload({status:404,responseText:'Not Found'})).importPost({url})).rejects.toThrow(/RESTART/);
  });
  it('round-trips GM → authenticated HTTP → isolated synthetic collector → browser revalidation, then uses cache',async()=>{
    const {spawnProcess}=fakeSpawn();
    const collectPost=vi.fn(({url:postUrl,signal})=>collectTradingIntel({executable:'FIXTURE',cwd:'ISOLATED_FIXTURE',postUrl,signal,
      spawnProcess,now:()=>now,readEvidence:async()=>trace()}));
    await withServer({collect:vi.fn(),collectPost,now:()=>now},async base=>{
      const gmRequest=vi.fn(options=>{
        fetch(base+'/v1/post',{method:options.method,headers:options.headers,body:options.data})
          .then(async response=>options.onload({status:response.status,responseText:await response.text()})).catch(options.onerror);
      });
      const intel=browser(gmRequest),first=await intel.importPost({url:url+'?s=20'}),second=await intel.importPost({url});
      expect(first.posts[0]).toMatchObject({url,entry:{ceiling:1500},evidence:'native-thread-post',conditions:null});
      expect(second.cached).toBe(true);expect(first.fetchedAt).toBe(second.fetchedAt);
      expect(collectPost).toHaveBeenCalledOnce();expect(spawnProcess).toHaveBeenCalledOnce();expect(gmRequest).toHaveBeenCalledTimes(2);
    });
  });
  it.each(['redirect','oversize','utf8size','substituted','noEvidence','stale','tooMany','timeout'])('rejects %s responses',async kind=>{
    const gm=o=>{
      if(kind==='timeout')return o.ontimeout();
      let value=normalized();if(kind==='substituted')value.posts[0].url=url.replace('FlipX_1','Other');
      if(kind==='noEvidence')delete value.nativeEvidence;if(kind==='stale')value.fetchedAt=now-900001;
      if(kind==='tooMany')value.posts.push(...Array.from({length:4},()=>reply()));
      const text=kind==='oversize'?' '.repeat(100001):kind==='utf8size'?JSON.stringify({...value,extra:'你'.repeat(34000)}):JSON.stringify(value);
      o.onload({status:200,responseText:text,...(kind==='redirect'?{finalUrl:'https://evil'}:{})});
    };
    await expect(browser(gm).importPost({url})).rejects.toThrow(/DESK_INTEL_/);
  });
});
