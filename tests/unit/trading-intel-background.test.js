import {expect,it,vi} from 'vitest';
import {createTradingIntelServer} from '../../scripts/trading-intel/server.mjs';
import {collectTradingIntel} from '../../scripts/trading-intel/collector.mjs';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createTradingIntelControl,tradingIntelControlMessage,showTradingIntelControlResult} from '../../scripts/trading-intel/control.mjs';
import {tradingIntelShortcutSpecs} from '../../scripts/trading-intel/install-shortcuts.mjs';
import {createFc27TradingIntel} from '../../src/adapters/browser/fc27-trading-intel.js';

const key='a'.repeat(48);
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;}
const post=(url,route,secret=key)=>fetch(`${url}/v1/${route}`,{method:'POST',headers:{'X-FCAT-Intel-Key':secret},body:'{}'});

it('authenticates shutdown, closes only its own server, and does not collect',async()=>{
  const collect=vi.fn(),server=createTradingIntelServer({key,collect}),url=await listen(server);
  try{
    expect((await post(url,'shutdown','wrong')).status).toBe(401);
    expect((await post(url,'status')).status).toBe(200);
    const closed=new Promise(r=>server.once('close',r));
    expect(await(await post(url,'shutdown')).json()).toMatchObject({service:'fcat-trading-intel',status:'stopping'});
    await closed;expect(collect).not.toHaveBeenCalled();
  }finally{server.closeAllConnections();server.close();}
});
it('cancels the active owned collection on shutdown without retrying it',async()=>{
  let entered;const started=new Promise(r=>entered=r),aborted=vi.fn();
  const collect=vi.fn(({signal}={})=>new Promise((_r,reject)=>{if(!signal){entered();reject(Error('DESK_INTEL_SIGNAL_MISSING'));return;}signal.addEventListener('abort',()=>{aborted();reject(Error('DESK_INTEL_STOPPED'));},{once:true});entered();}));
  const server=createTradingIntelServer({key,collect}),url=await listen(server);
  try{
    const pending=post(url,'refresh');await started;expect((await(await post(url,'status')).json()).collecting).toBe(true);
    const closed=new Promise(r=>server.once('close',r));expect((await post(url,'shutdown')).status).toBe(200);
    expect(await(await pending).json()).toMatchObject({error:'DESK_INTEL_STOPPED'});await closed;
    expect(aborted).toHaveBeenCalledOnce();expect(collect).toHaveBeenCalledOnce();
  }finally{server.closeAllConnections();server.close();}
});
it('cancels its Grok child and does not read traces or fabricate successful output',async()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=vi.fn();
  const spawnProcess=vi.fn(()=>child),readEvidence=vi.fn(),controller=new AbortController();
  const result=collectTradingIntel({executable:'FIXTURE',cwd:'FIXTURE',spawnProcess,readEvidence,signal:controller.signal,timeoutMs:50});
  const check=expect(result).rejects.toThrow('DESK_INTEL_STOPPED');controller.abort();await check;
  expect(child.kill).toHaveBeenCalledOnce();expect(readEvidence).not.toHaveBeenCalled();
  await expect(collectTradingIntel({executable:'FIXTURE',cwd:'FIXTURE',spawnProcess,signal:controller.signal})).rejects.toThrow('DESK_INTEL_STOPPED');
  expect(spawnProcess).toHaveBeenCalledOnce();
});
it('runs detached and hidden, reuses existing service, stops and restarts without changing pairing',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'fcat background 测试 '));
  const probe=createTradingIntelServer({key,collect:vi.fn()});await listen(probe);const port=probe.address().port;await new Promise(r=>probe.close(r));
  const serverFile=path.join(directory,'server fixture.mjs');
  const source=pathToFileURL(path.resolve('scripts/trading-intel/server.mjs')).href;
  await writeFile(serverFile,`import {startTradingIntelServer} from ${JSON.stringify(source)};await startTradingIntelServer(${JSON.stringify({directory,port,background:true})});`);
  const spawnProcess=vi.fn((...args)=>spawn(...args)),control=createTradingIntelControl({directory,port,serverFile,spawnProcess});
  try{
    expect(await control.status()).toEqual({status:'stopped'});
    const starts=await Promise.all([control.start(),control.start(),control.start()]);
    expect(starts.every(v=>v.status==='ready'&&v.background===true&&v.collecting===false)).toBe(true);expect(starts.filter(v=>v.started)).toHaveLength(1);
    const originalKey=await readFile(path.join(directory,'pairing-key'),'utf8');
    expect(originalKey).toMatch(/^[a-f0-9]{48}$/);expect(await readFile(path.join(directory,'collector.log'),'utf8')).not.toContain(originalKey);
    expect(spawnProcess.mock.calls[0][2]).toMatchObject({detached:true,windowsHide:true});
    expect(await control.start()).toMatchObject({alreadyRunning:true});expect(spawnProcess).toHaveBeenCalledOnce();
    expect(await control.stop()).toMatchObject({status:'stopped',stopped:true});expect(await control.stop()).toMatchObject({alreadyStopped:true});
    expect(await control.start()).toMatchObject({background:true,collecting:false});expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(directory,'pairing-key'),'utf8')).toBe(originalKey);
    expect(JSON.stringify(await control.status())).not.toContain(originalKey);
  }finally{await control.stop();}
});
it('does not spawn or kill an unrelated listener or overwrite a mismatched pairing',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'fcat background auth '));await writeFile(path.join(directory,'pairing-key'),'b'.repeat(48));
  const server=createTradingIntelServer({key,collect:vi.fn()});await listen(server);const spawnProcess=vi.fn();
  const control=createTradingIntelControl({directory,port:server.address().port,spawnProcess});
  try{await expect(control.start()).rejects.toThrow('DESK_INTEL_PAIRING_REJECTED');await expect(control.stop()).rejects.toThrow('DESK_INTEL_PAIRING_REJECTED');
    expect(server.listening).toBe(true);expect(spawnProcess).not.toHaveBeenCalled();expect(await readFile(path.join(directory,'pairing-key'),'utf8')).toBe('b'.repeat(48));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('builds three hidden desktop controls with safely quoted fixed local actions and no stored secret',()=>{
  const specs=tradingIntelShortcutSpecs({executable:"C:\\Some Node's Folder\\node.exe",controller:"D:\\My FCAT's scripts\\control.mjs"});
  expect(specs.map(s=>s.action)).toEqual(['start','status','stop']);
  for(const s of specs){expect(s.arguments).toContain('-WindowStyle Hidden');expect(s.command).toContain("Node''s");expect(s.command).toContain("FCAT''s");
    expect(Buffer.from(s.arguments.split(' ').at(-1),'base64').toString('utf16le')).toBe(s.command);expect(s.arguments).toMatch(/^[\x20-\x7e]+$/);
    expect(s.arguments.length).toBeLessThan(1000);
    expect(s.arguments).not.toContain('ExecutionPolicy');expect(s.command).not.toContain('refresh');expect(s.command).not.toContain(key);}
  expect(tradingIntelControlMessage({status:'ready',background:true})).toContain('不会自动采集');
  expect(tradingIntelControlMessage({status:'stopped'})).toContain('配对码和设置保留');
});
it('keeps Unicode status data outside shell code and below the Windows shortcut argument truncation limit',()=>{
  const spawnCommand=vi.fn(()=>({status:0})),message="后台采集器运行中；'quoted' $not-code";
  showTradingIntelControlResult({message},{spawnCommand});const [,args,options]=spawnCommand.mock.calls[0];
  expect(options).toMatchObject({windowsHide:true,shell:false,env:{FCAT_INTEL_CONTROL_MESSAGE:message}});expect(args.join(' ')).not.toContain(message);
  expect(()=>tradingIntelShortcutSpecs({controller:'D:\\'+ 'x'.repeat(600)})).toThrow('SHORTCUT_PATH_TOO_LONG');
});
it('browser stop uses only authenticated fixed shutdown and keeps saved pairing',async()=>{
  const get=vi.fn(async()=>key),set=vi.fn(),gmRequest=vi.fn(o=>o.onload({status:200,responseText:JSON.stringify({schema:1,service:'fcat-trading-intel',status:'stopping'})}));
  const intel=createFc27TradingIntel({get,set,gmRequest});expect(await intel.stop()).toMatchObject({stopping:true,configured:true});
  expect(gmRequest.mock.calls[0][0]).toMatchObject({url:'http://127.0.0.1:17864/v1/shutdown',method:'POST',data:'{}',headers:{'X-FCAT-Intel-Key':key}});
  expect(set).not.toHaveBeenCalled();
  const legacy=createFc27TradingIntel({get,set,gmRequest:o=>o.onload({status:404,responseText:'{}'})});await expect(legacy.stop()).rejects.toThrow('STATUS_UNSUPPORTED');
});
