import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectTradingIntel} from './collector.mjs';
import {parseEventPostUrl} from '../../src/trading/event-intel.js';

export async function tradingIntelProxy(env=process.env){
  const valid=value=>/^http:\/\/127\.0\.0\.1:\d+$/.test(value??'');
  if(env.FCAT_INTEL_PROXY){if(!valid(env.FCAT_INTEL_PROXY))throw Error('DESK_INTEL_PROXY_INVALID');return env.FCAT_INTEL_PROXY;}
  const existing=env.HTTPS_PROXY??env.HTTP_PROXY;if(valid(existing))return existing;
  // Reuse a static loopback proxy from an installed Windows Grok wrapper.
  // Never execute or evaluate wrapper text, expand variables or read auth files.
  if(process.platform==='win32')for(const dir of String(env.Path??env.PATH??'').split(path.delimiter).slice(0,128)){
    if(!dir)continue;try{const text=await readFile(path.join(dir,'grok.cmd'),'utf8');if(text.length>4096)continue;
      const value=/^set "HTTPS_PROXY=(http:\/\/127\.0\.0\.1:\d+)"\r?$/m.exec(text)?.[1];if(valid(value))return value;
    }catch{/* Most PATH entries have no Grok wrapper. */}
  }
  return null;
}

function readPostRequest(req){
  return new Promise((resolve,reject)=>{
    let size=0,done=false;const chunks=[];
    const timer=setTimeout(()=>fail('DESK_INTEL_REQUEST_TIMEOUT'),4000);
    const fail=code=>{if(done)return;done=true;clearTimeout(timer);chunks.length=0;reject(Error(code));};
    if(Number(req.headers['content-length'])>1024){req.resume();fail('DESK_INTEL_REQUEST_LIMIT');return;}
    req.on('data',chunk=>{if(done)return;size+=chunk.length;
      if(size>1024){fail('DESK_INTEL_REQUEST_LIMIT');req.resume();return;}chunks.push(chunk);
    });
    req.once('error',()=>fail('DESK_INTEL_REQUEST_INVALID'));
    req.once('aborted',()=>fail('DESK_INTEL_REQUEST_INVALID'));
    req.once('end',()=>{if(done)return;
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('DESK_INTEL_REQUEST_INVALID');return;}
      const post=body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1
        &&Object.hasOwn(body,'url')?parseEventPostUrl(body.url):null;
      if(!post){fail('DESK_INTEL_URL_INVALID');return;}done=true;clearTimeout(timer);resolve(post);
    });
  });
}

function responseJson(value){
  let text;try{text=JSON.stringify(value);}catch{throw Error('DESK_INTEL_RESPONSE_INVALID');}
  if(typeof text!=='string')throw Error('DESK_INTEL_RESPONSE_INVALID');
  if(Buffer.byteLength(text)>100000)throw Error('DESK_INTEL_RESPONSE_LIMIT');return text;
}

export function createTradingIntelServer({key,collect,collectPost,now=()=>Date.now(),maxRuns=24,background=false}){
  let cache=null,pending=null,retryAt=0,day='',runs=0,controller=null,stopping=false;
  const postCache=new Map(),dailyLimit=Number.isSafeInteger(maxRuns)?Math.max(0,Math.min(24,maxRuns)):24;
  const server=http.createServer(async(req,res)=>{
    const reply=(status,value)=>{let text;try{text=responseJson(value);}catch(error){status=503;text=JSON.stringify({error:error.message});}
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(text);};
    // Loopback only, no wildcard CORS, redirects, caller queries or commands.
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host??'')||req.method!=='POST'||!['/v1/refresh','/v1/post','/v1/status','/v1/shutdown'].includes(req.url))return reply(404,{error:'DESK_INTEL_ROUTE_INVALID'});
    const supplied=req.headers['x-fcat-intel-key'];
    if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(key)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))return reply(401,{error:'DESK_INTEL_PAIRING_REQUIRED'});
    if(req.url!=='/v1/post')req.resume();
    if(stopping)return reply(503,{error:'DESK_INTEL_STOPPED'});
    if(req.url==='/v1/shutdown'){
      stopping=true;res.once('finish',()=>{controller?.abort();server.close();});
      reply(200,{schema:1,service:'fcat-trading-intel',status:'stopping'});return;
    }
    if(req.url==='/v1/status')return reply(200,{schema:1,service:'fcat-trading-intel',status:'ready',collecting:pending!==null,background,canStop:true});
    let post=null;
    if(req.url==='/v1/post')try{post=await readPostRequest(req);}catch(error){
      const status=error.message==='DESK_INTEL_REQUEST_TIMEOUT'?408:error.message==='DESK_INTEL_REQUEST_LIMIT'?413:400;
      if(status===408||status===413){req.resume();res.setHeader('Connection','close');}
      return reply(status,{error:error.message});
    }
    // Shutdown could arrive while this request's small body was still streaming.
    if(stopping)return reply(503,{error:'DESK_INTEL_STOPPED'});
    const jobId=post?`post:${post.author.toLowerCase()}:${post.id}`:'refresh';
    if(pending&&pending.id!==jobId)return reply(409,{error:'DESK_INTEL_BUSY'});
    if(!pending){
      const time=now();
      for(const [id,item] of postCache)if(time<item.at||time-item.at>=900000)postCache.delete(id);
      if(post){const cached=postCache.get(jobId);
        if(cached){postCache.delete(jobId);postCache.set(jobId,cached);return reply(200,{...cached.value,cached:true});}
      }else if(cache&&time>=cache.fetchedAt&&time-cache.fetchedAt<900000)return reply(200,{...cache,cached:true});
      if(time<retryAt)return reply(429,{error:'DESK_INTEL_COOLDOWN',retryAt});
      const today=new Date(time).toISOString().slice(0,10);if(day!==today){day=today;runs=0;}
      if(runs>=dailyLimit)return reply(429,{error:'DESK_INTEL_DAILY_LIMIT'});
      const collector=post?collectPost:collect;
      if(typeof collector!=='function')return reply(503,{error:'DESK_INTEL_COLLECTOR_UNAVAILABLE'});
      runs++;controller=new AbortController();
      const signal=controller.signal,job={id:jobId,promise:null};pending=job;
      job.promise=Promise.resolve().then(()=>collector(post?{url:post.url,signal}:{signal})).then(value=>{
        if(stopping||signal.aborted)throw Error('DESK_INTEL_STOPPED');
        responseJson(value); // Reject before caching; failed output enters shared backoff.
        if(post){postCache.set(jobId,{value,at:now()});while(postCache.size>5)postCache.delete(postCache.keys().next().value);}
        else cache=value;return value;
      }).catch(error=>{retryAt=now()+60000;throw error;}).finally(()=>{if(pending===job){pending=null;controller=null;}});
    }
    const job=pending;
    try{reply(200,await job.promise);}catch(error){reply(503,{error:/^DESK_INTEL_[A-Z_]+$/.test(error?.message)?error.message:'DESK_INTEL_UNAVAILABLE'});}
  });
  return server;
}
export async function startTradingIntelServer({directory=path.join(os.homedir(),'.fcat-trading-intel'),port=17864,background=false,collectIntel=collectTradingIntel}={}){
  await mkdir(directory,{recursive:true});
  const keyPath=path.join(directory,'pairing-key'),job=await mkdtemp(path.join(os.tmpdir(),'fcat-intel-'));
  let key;try{key=(await readFile(keyPath,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;
    try{await writeFile(keyPath,randomBytes(24).toString('hex'),{mode:0o600,flag:'wx'});}catch(writeError){if(writeError.code!=='EEXIST')throw writeError;}
    key=(await readFile(keyPath,'utf8')).trim();}
  if(!/^[a-f0-9]{48}$/.test(key))throw Error('DESK_INTEL_PAIRING_INVALID');
  const executable=process.env.FCAT_GROK_EXE??path.join(os.homedir(),'.grok','bin',process.platform==='win32'?'grok.exe':'grok');
  const proxy=await tradingIntelProxy();
  const env={...process.env,...(proxy?{HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,NO_PROXY:'127.0.0.1,localhost'}:{})};
  // Fresh cwd per job, outside the repository. Trace lookup is bound to that
  // cwd AND the returned session ID; imports never inspect another job's log.
  const run=async({signal,url})=>{
    if(signal.aborted)throw Error('DESK_INTEL_STOPPED');
    const cwd=await mkdtemp(path.join(job,'job-'));
    return collectIntel({executable,cwd,env,signal,...(url?{postUrl:url}:{})});
  };
  const server=createTradingIntelServer({key,background,collect:run,collectPost:run});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log(`FCAT X collector ready at 127.0.0.1:${port}. On demand only; each successful result cached 15 minutes; no timer.`);
  if(!background)console.log('Pairing key is stored locally in the collector directory; it is never printed.');return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.slice(2).some(arg=>arg!=='--background'))throw Error('DESK_INTEL_ARGUMENT_INVALID');
  await startTradingIntelServer({background:process.argv.includes('--background')});
}
