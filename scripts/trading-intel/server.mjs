import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectTradingIntel} from './collector.mjs';

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

export function createTradingIntelServer({key,collect,now=()=>Date.now(),maxRuns=24}){
  let cache=null,pending=null,retryAt=0,day='',runs=0;
  return http.createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    // Loopback only, no wildcard CORS, redirects, caller queries or commands.
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host??'')||req.method!=='POST'||!['/v1/refresh','/v1/status'].includes(req.url))return reply(404,{error:'DESK_INTEL_ROUTE_INVALID'});
    const supplied=req.headers['x-fcat-intel-key'];
    if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(key)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))return reply(401,{error:'DESK_INTEL_PAIRING_REQUIRED'});
    req.resume();
    if(req.url==='/v1/status')return reply(200,{schema:1,service:'fcat-trading-intel',status:'ready',collecting:pending!==null});
    if(cache&&now()-cache.fetchedAt<900000)return reply(200,{...cache,cached:true});
    if(now()<retryAt)return reply(429,{error:'DESK_INTEL_COOLDOWN',retryAt});
    const today=new Date(now()).toISOString().slice(0,10);if(day!==today){day=today;runs=0;}
    if(!pending){if(runs>=maxRuns)return reply(429,{error:'DESK_INTEL_DAILY_LIMIT'});runs++;
      pending=collect().then(value=>{cache=value;return value;}).catch(error=>{retryAt=now()+60000;throw error;}).finally(()=>{pending=null;});}
    try{reply(200,await pending);}catch(error){reply(503,{error:/^DESK_INTEL_[A-Z_]+$/.test(error.message)?error.message:'DESK_INTEL_UNAVAILABLE'});}
  });
}
export async function startTradingIntelServer(){
  const directory=path.join(os.homedir(),'.fcat-trading-intel');await mkdir(directory,{recursive:true});
  const keyPath=path.join(directory,'pairing-key'),job=await mkdtemp(path.join(os.tmpdir(),'fcat-intel-'));
  let key;try{key=(await readFile(keyPath,'utf8')).trim();}catch{key=randomBytes(24).toString('hex');await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}
  if(!/^[a-f0-9]{48}$/.test(key))throw Error('DESK_INTEL_PAIRING_INVALID');
  const executable=process.env.FCAT_GROK_EXE??path.join(os.homedir(),'.grok','bin',process.platform==='win32'?'grok.exe':'grok');
  const proxy=await tradingIntelProxy();
  const env={...process.env,...(proxy?{HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,NO_PROXY:'127.0.0.1,localhost'}:{})};
  const server=createTradingIntelServer({key,collect:()=>collectTradingIntel({executable,cwd:job,env})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(17864,'127.0.0.1',resolve);});
  console.log('FCAT X collector ready at 127.0.0.1:17864. On demand only; each successful result cached 15 minutes; no timer.');
  console.log(`Pairing key (local only; do not share): ${key}`);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await startTradingIntelServer();
