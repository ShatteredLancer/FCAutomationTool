import {expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {normalizeTradingIntel,intelPostUrl,intelEvents,INTEL_HANDLES} from '../../src/trading/intel.js';
import {collectTradingIntel,intelPrompt,readGrokIntelEvidence} from '../../scripts/trading-intel/collector.mjs';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createTradingIntelServer,tradingIntelProxy} from '../../scripts/trading-intel/server.mjs';
import {createFc27TradingIntel} from '../../src/adapters/browser/fc27-trading-intel.js';

const now=Date.parse('2026-11-04T08:00:00Z'),id=at=>String((BigInt(at)-1288834974657n)<<22n);
const post=(extra={})=>({url:`https://x.com/FutSheriff/status/${id(now-10000)}`,publishedAt:new Date(now-10000).toISOString(),
  text:'Example EVO. Which player?','parentUrl':null,topic:'evo',players:[],conditions:null,...extra});
const payload=(posts=[post()])=>({schema:1,posts});
it('validates original allowed-account status links and does not follow arbitrary news URLs',()=>{
  expect(intelPostUrl(post().url+'?s=20').url).toBe(post().url);
  for(const url of ['https://example.com/FutSheriff/status/123','http://x.com/FutSheriff/status/123','https://x.com/Other/status/1234567890123456789'])expect(intelPostUrl(url)).toBeNull();
});
it('includes DetectiveFUT in native searches and verifies its own author-reply evidence without assigning a rating',()=>{
  const root=id(now-30000),reply=post({url:`https://x.com/DetectiveFUT/status/${id(now-10000)}`,parentUrl:`https://x.com/DetectiveFUT/status/${root}`});
  expect(INTEL_HANDLES).toContain('DetectiveFUT');expect(intelPrompt(now)).toContain('DetectiveFUT');
  const value=normalizeTradingIntel(payload([reply]),now,{calls:[{name:'x_thread_fetch',input:{post_id:root}},
    {name:'x_keyword_search',input:{query:`conversation_id:${root} from:DetectiveFUT`}}]});
  expect(value.posts[0]).toMatchObject({author:'DetectiveFUT',evidence:'native-thread-author-reply',threadChecked:true});
  expect(value.posts[0]).not.toHaveProperty('accuracy');expect(intelPostUrl(reply.url.replace('DetectiveFUT','DetectiveFUT1'))).toBeNull();
});
it('keeps reported author replies and named players when EVO conditions remain unknown',()=>{
  const value=normalizeTradingIntel(payload([post({text:'Example player fits.',parentUrl:`https://x.com/FutSheriff/status/${id(now-30000)}`,
    players:[{name:'Example player',nominationQuote:'Example player fits.'}]})]),now);
  expect(value.posts[0]).toMatchObject({evidence:'search-reported-author-reply',threadComplete:false,evo:null,players:[{name:'Example player',version:null}]});
  expect(intelEvents(value)[0]).toMatchObject({status:'leak',players:[{name:'Example player',version:null}]});
  expect(value.realTime).toBe(false);
});
it('does not turn an EVO theme title or a season label into a nominated card version',()=>{
  const value=normalizeTradingIntel(payload([post({text:'David Luiz EVO is here.',players:[{name:'David Luiz',version:'FC27'}]})]),now);
  expect(value.posts[0].players[0]).toMatchObject({name:'David Luiz',version:null,nominationQuote:null});expect(intelEvents(value)[0].players).toEqual([]);
});
it('validates proxy input as static loopback settings, not shell text',async()=>{
  expect(await tradingIntelProxy({FCAT_INTEL_PROXY:'http://127.0.0.1:7897'})).toBe('http://127.0.0.1:7897');
  expect(await tradingIntelProxy({})).toBeNull();await expect(tradingIntelProxy({FCAT_INTEL_PROXY:'http://external.example; command'})).rejects.toThrow('INVALID');
});
it('does not promote community/other-author comments or search results to verified leaker replies',()=>{
  const value=normalizeTradingIntel(payload([post({parentUrl:`https://x.com/FutPoliceLeaks/status/${id(now-30000)}`})]),now);
  expect(value.posts[0]).toMatchObject({parentUrl:null,evidence:'search-reported-post'});
});
it('rejects relabelled old IDs, future posts and missing publication evidence',()=>{
  expect(normalizeTradingIntel(payload([post({publishedAt:new Date(now-86400000).toISOString()}),post({publishedAt:'unknown'}),
    post({url:`https://x.com/FutSheriff/status/${id(now+600000)}`,publishedAt:new Date(now+600000).toISOString()})]),now).posts).toEqual([]);
});
it('deduplicates repeated posts and exact copied text without inventing independent confirmation',()=>{
  const value=normalizeTradingIntel(payload([post(),post(),post({url:`https://x.com/FutPoliceLeaks/status/${id(now-20000)}`,publishedAt:new Date(now-20000).toISOString()})]),now);
  expect(value.posts).toHaveLength(1);expect(value.posts[0]).not.toHaveProperty('confidence');
});
it('keeps only stated rating/position prefilters and bounded projected data',()=>{
  const value=normalizeTradingIntel(payload([post({conditions:{maxRating:82,positions:['CB','wrong'],pace:90},private:'secret',image:'x'.repeat(20000)})]),now);
  expect(value.posts[0].evo).toEqual({maxRating:82,positions:['CB']});expect(JSON.stringify(value)).not.toContain('secret');
  expect(()=>normalizeTradingIntel(payload(Array.from({length:31},()=>post())),now)).toThrow('INVALID');
});
it('uses a read-only isolated CLI with finite turns/output, not shell execution or private repo context',async()=>{
  const spawn=vi.fn(()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=vi.fn();
    queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({stopReason:'end_turn',text:JSON.stringify(payload()),total_cost_usd:.02})));child.emit('close',0);});return child;});
  const result=await collectTradingIntel({executable:'GROK_EXE',cwd:'ISOLATED_TEMP',spawnProcess:spawn,now:()=>now,
    readEvidence:async()=>({calls:[{name:'x_keyword_search',input:{query:'from:FutSheriff EVO'}}]})});
  expect(result.posts).toHaveLength(1);expect(result.costUsd).toBe(.02);expect(spawn.mock.calls[0][2]).toMatchObject({shell:false,windowsHide:true,cwd:'ISOLATED_TEMP'});
  expect(spawn.mock.calls[0][1]).toContain('--no-subagents');expect(spawn.mock.calls[0][1]).not.toContain('--tools');
  expect(spawn.mock.calls[0][1]).toContain('MCPTool');expect(spawn.mock.calls[0][2].env.GROK_MEMORY).toBe('0');
  expect(result.provider).toBe('grok-native-x');
  expect(intelPrompt(now)).toContain('SAME AUTHOR');
});
it('rejects generated claims of native X use when the actual trace contains only generic web search',async()=>{
  const spawn=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({stopReason:'end_turn',text:JSON.stringify(payload())})));child.emit('close',0);});return child;};
  await expect(collectTradingIntel({executable:'GROK',cwd:'TEMP',spawnProcess:spawn,now:()=>now,
    readEvidence:async()=>({calls:[{name:'web_search',input:{query:'I used x_thread_fetch'}}]})})).rejects.toThrow('NATIVE_X_NOT_USED');
});
it('checks the isolated job trace for completed native X calls, not tool names in ordinary text',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'fcat-intel-evidence-')),cwd='ISOLATED_TEMP',sessionId='12345678-1234-1234-1234-123456789012';
  const directory=path.join(home,'sessions',encodeURIComponent(cwd),sessionId);await mkdir(directory,{recursive:true});
  const event=(status,name)=>({params:{update:{sessionUpdate:'tool_call_update',status,rawOutput:{name,input:JSON.stringify({post_id:id(now-30000)})}}}});
  await writeFile(path.join(directory,'updates.jsonl'),[event('completed','web_search'),event('failed','x_thread_fetch'),event('completed','x_thread_fetch')].map(JSON.stringify).join('\n'));
  expect((await readGrokIntelEvidence({cwd,sessionId,home})).calls).toEqual([{name:'x_thread_fetch',input:{post_id:id(now-30000)}}]);
});
it('marks an author reply checked only after real thread AND author-filtered conversation calls',()=>{
  const root=id(now-30000),reply=post({parentUrl:`https://x.com/FutSheriff/status/${root}`,players:[{name:'Example player'}]});
  const calls=[{name:'x_keyword_search',input:{query:'from:FutSheriff evo'}},{name:'x_thread_fetch',input:{post_id:root}}];
  expect(normalizeTradingIntel(payload([reply]),now,{calls}).posts[0]).toMatchObject({parentUrl:null,evidence:'native-search-post',threadChecked:false});
  calls.push({name:'x_keyword_search',input:{query:`conversation_id:${root} from:FutSheriff`}});
  expect(normalizeTradingIntel(payload([reply]),now,{calls}).posts[0]).toMatchObject({parentUrl:reply.parentUrl,evidence:'native-thread-author-reply',threadChecked:true,threadComplete:false});
});
it('rejects cancelled CLI outputs instead of showing a successful empty refresh',async()=>{
  const spawn=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({stopReason:'cancelled',text:JSON.stringify(payload())})));child.emit('close',0);});return child;};
  await expect(collectTradingIntel({executable:'GROK',cwd:'TEMP',spawnProcess:spawn,now:()=>now})).rejects.toThrow('INVALID');
});
async function withServer(options,task){const server=createTradingIntelServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await task(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
const key='a'.repeat(48),request=(url,extra={})=>fetch(url+'/v1/refresh',{method:'POST',headers:{'x-fcat-intel-key':key},...extra});
it('collects only on authenticated explicit refresh, caches results and never starts a background timer',async()=>{
  const collect=vi.fn(async()=>normalizeTradingIntel(payload(),now));
  await withServer({key,collect,now:()=>now},async url=>{
    expect(collect).not.toHaveBeenCalled();expect((await fetch(url+'/v1/refresh')).status).toBe(404);
    expect((await request(url,{headers:{'x-fcat-intel-key':'wrong'}})).status).toBe(401);expect(collect).not.toHaveBeenCalled();
    expect((await request(url)).status).toBe(200);expect((await(await request(url)).json()).cached).toBe(true);expect(collect).toHaveBeenCalledTimes(1);
    expect((await fetch(url+'/v1/refresh?command=anything',{method:'POST',headers:{'x-fcat-intel-key':key}})).status).toBe(404);
  });
});
it('deduplicates simultaneous refreshes and fails into cooldown, not an automatic paid retry',async()=>{
  let release;const collect=vi.fn(()=>new Promise(resolve=>{release=resolve;}));
  await withServer({key,collect,now:()=>now},async url=>{const first=request(url),second=request(url);while(!release)await new Promise(r=>setTimeout(r,2));
    await new Promise(r=>setTimeout(r,15));release(normalizeTradingIntel(payload(),now));expect((await first).status).toBe(200);expect((await second).status).toBe(200);expect(collect).toHaveBeenCalledTimes(1);});
  const fail=vi.fn(async()=>{throw Error('DESK_INTEL_TIMEOUT');});
  await withServer({key,collect:fail,now:()=>now},async url=>{expect((await request(url)).status).toBe(503);expect((await request(url)).status).toBe(429);expect(fail).toHaveBeenCalledTimes(1);});
});
it('pairs privately and sends no account, inventory, trade ledger or arbitrary query to the collector',async()=>{
  const data=new Map(),gm=vi.fn(options=>options.onload({status:200,responseText:JSON.stringify(options.url.endsWith('/status')
    ?{schema:1,service:'fcat-trading-intel',status:'ready',collecting:false}:normalizeTradingIntel(payload(),now))}));
  const service=createFc27TradingIntel({gmRequest:gm,get:async k=>data.get(k),set:async(k,v)=>data.set(k,v),now:()=>now});
  await expect(service.refresh()).rejects.toThrow('PAIRING');await service.pair(key);expect((await service.refresh()).posts).toHaveLength(1);
  expect(gm.mock.calls[0][0]).toMatchObject({url:'http://127.0.0.1:17864/v1/status',method:'POST',data:'{}'});
  expect(gm.mock.calls[1][0]).toMatchObject({url:'http://127.0.0.1:17864/v1/refresh',method:'POST',data:'{}'});
  expect(gm.mock.calls[0][0].headers['X-FCAT-Intel-Key']).toBe(key);expect([...data.keys()]).toEqual(['fcat-trading-intel-pairing-v1']);
});
it('does not report a saved pairing when storage silently discards the write',async()=>{
  const service=createFc27TradingIntel({gmRequest:vi.fn(options=>options.onerror()),get:async()=>'',set:async()=>{},now:()=>now});
  await expect(service.pair(key)).rejects.toThrow('DESK_INTEL_SAVE_UNVERIFIED');
});
it('persists while the collector is offline, reports saved versus connected, and rereads without a network request',async()=>{
  const data=new Map(),gm=vi.fn(o=>o.onerror()),service=createFc27TradingIntel({gmRequest:gm,get:async(k,f)=>data.get(k)??f,set:async(k,v)=>data.set(k,v)});
  expect(await service.config()).toEqual({configured:false});expect(gm).not.toHaveBeenCalled();
  expect(await service.pair(` '${key.toUpperCase()}' `)).toMatchObject({saved:true,configured:true,connected:false,connection:'unreachable'});
  expect(await service.config()).toEqual({configured:true});expect(gm).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(await service.config())).not.toContain(key);expect(gm.mock.calls[0][0].url.endsWith('/status')).toBe(true);
});
it('preserves the existing pairing if a running collector rejects a proposed replacement',async()=>{
  let value=key;const set=vi.fn(async(_k,v)=>{value=v;}),gm=vi.fn(o=>o.onload({status:401,responseText:'{"error":"DESK_INTEL_PAIRING_REQUIRED"}'}));
  const service=createFc27TradingIntel({gmRequest:gm,get:async()=>value,set});
  await expect(service.pair('b'.repeat(48))).rejects.toThrow('PAIRING_REJECTED');expect(value).toBe(key);expect(set).not.toHaveBeenCalled();
});
it('identifies an older collector without claiming its connection was verified, and handles storage failures explicitly',async()=>{
  let value='';const gm=vi.fn(o=>o.onload({status:404,responseText:'{"error":"DESK_INTEL_ROUTE_INVALID"}'}));
  const service=createFc27TradingIntel({gmRequest:gm,get:async()=>value,set:async(_k,v)=>{value=v;}});
  expect(await service.pair(key)).toMatchObject({saved:true,connected:false,connection:'legacy'});
  const failed=createFc27TradingIntel({gmRequest:vi.fn(o=>o.onerror()),get:async()=>'',set:async()=>{throw Error('storage');}});
  await expect(failed.pair(key)).rejects.toThrow('SAVE_FAILED');
});
it('checks an authenticated collector without starting collection or consuming its daily allowance',async()=>{
  const collect=vi.fn(async()=>{throw Error('must not collect');});
  await withServer({key,collect,now:()=>now,maxRuns:0},async url=>{
    const result=await fetch(url+'/v1/status',{method:'POST',headers:{'x-fcat-intel-key':key}});
    expect(result.status).toBe(200);expect(await result.json()).toMatchObject({schema:1,service:'fcat-trading-intel',status:'ready',collecting:false});
    expect((await request(url)).status).toBe(429);expect(collect).not.toHaveBeenCalled();
    expect((await fetch(url+'/v1/status',{method:'POST'})).status).toBe(401);
  });
});
