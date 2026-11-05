import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,open,readFile,stat,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function createTradingIntelControl({directory=path.join(os.homedir(),'.fcat-trading-intel'),port=17864,
  executable=process.execPath,serverFile=path.join(import.meta.dirname,'server.mjs'),spawnProcess=spawn,timeoutMs=6000}={}){
  const keyFile=path.join(directory,'pairing-key');
  const key=async()=>{try{const value=(await readFile(keyFile,'utf8')).trim();if(!/^[a-f0-9]{48}$/.test(value))throw Error('DESK_INTEL_PAIRING_INVALID');return value;}
    catch(error){if(error.code==='ENOENT')return '';throw error;}};
  const query=async route=>{const secret=await key();return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:`/v1/${route}`,method:'POST',agent:false,
      headers:{'X-FCAT-Intel-Key':secret,'Content-Type':'application/json','Connection':'close'}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(text.length>8192)req.destroy(Error('DESK_INTEL_RESPONSE_INVALID'));});
      res.on('end',()=>{try{
        if(res.statusCode===401)throw Error('DESK_INTEL_PAIRING_REJECTED');
        if(res.statusCode===404)throw Error('DESK_INTEL_STATUS_UNSUPPORTED');
        const value=JSON.parse(text);
        if(res.statusCode===503&&value.error==='DESK_INTEL_STOPPED')return resolve({status:'stopping'});
        if(res.statusCode!==200||value.schema!==1||value.service!=='fcat-trading-intel'
          ||value.status!==(route==='shutdown'?'stopping':'ready'))throw Error('DESK_INTEL_RESPONSE_INVALID');
        resolve({status:value.status,collecting:value.collecting===true,background:value.background===true,canStop:value.canStop===true});
      }catch(error){reject(error.message?.startsWith('DESK_INTEL_')?error:Error('DESK_INTEL_RESPONSE_INVALID'));}});
      res.on('error',()=>reject(Error('DESK_INTEL_RESPONSE_INVALID')));
    });
    req.setTimeout(1000,()=>req.destroy(Error('DESK_INTEL_STATUS_TIMEOUT')));
    req.on('error',error=>error.code==='ECONNREFUSED'?resolve({status:'stopped'}):reject(Error(error.message?.startsWith('DESK_INTEL_')?error.message:'DESK_INTEL_COLLECTOR_UNAVAILABLE')));
    req.end('{}');
  });};
  const wait=async desired=>{const end=Date.now()+timeoutMs;do{try{const value=await query('status');if(value.status===desired)return value;}
    catch(error){if(!['DESK_INTEL_COLLECTOR_UNAVAILABLE','DESK_INTEL_STATUS_TIMEOUT'].includes(error.message))throw error;}
    await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);throw Error(desired==='ready'?'DESK_INTEL_START_UNVERIFIED':'DESK_INTEL_STOP_UNVERIFIED');};
  const startLock=async()=>{const file=path.join(directory,'launcher.lock'),end=Date.now()+timeoutMs;
    do{try{const handle=await open(file,'wx',0o600);return async()=>{await handle.close();await unlink(file).catch(()=>{});};}
      catch(error){if(error.code!=='EEXIST')throw error;
        // This fixed local lock is not a PID or authority to terminate a process.
        try{if(Date.now()-(await stat(file)).mtimeMs>30000){await unlink(file);continue;}}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if((await query('status')).status==='ready')return null;await new Promise(r=>setTimeout(r,100));
      }
    }while(Date.now()<end);throw Error('DESK_INTEL_START_UNVERIFIED');};
  return Object.freeze({
    status:()=>query('status'),
    async start(){const current=await query('status');if(current.status==='ready')return {...current,alreadyRunning:true};
      if(current.status!=='stopped')throw Error('DESK_INTEL_STOP_UNVERIFIED');
      await mkdir(directory,{recursive:true});
      const release=await startLock();if(!release)return {...await query('status'),alreadyRunning:true};
      try{const existing=await query('status');if(existing.status==='ready')return {...existing,alreadyRunning:true};
        const log=await open(path.join(directory,'collector.log'),'w',0o600);let child;
        try{child=spawnProcess(executable,[serverFile,'--background'],{cwd:path.dirname(serverFile),detached:true,windowsHide:true,
          stdio:['ignore',log.fd,log.fd]});await new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('DESK_INTEL_START_FAILED')));child.once('spawn',resolve);});child.unref();}
        finally{await log.close();}
        return {...await wait('ready'),started:true};
      }finally{await release();}
    },
    async stop(){const current=await query('status');if(current.status==='stopped')return {...current,alreadyStopped:true};
      if(current.status==='ready')try{await query('shutdown');}catch(error){if(!['DESK_INTEL_COLLECTOR_UNAVAILABLE','DESK_INTEL_STATUS_TIMEOUT'].includes(error.message))throw error;}
      await wait('stopped');return {status:'stopped',stopped:true};
    },
  });
}

export function tradingIntelControlMessage(value){
  if(value.status==='stopped')return '采集器已停止。配对码和设置保留；需要时双击“启动采集器”。';
  if(value.status==='stopping')return '采集器正在停止，请稍后查看状态。';
  return `${value.background?'后台采集器':'采集器（前台模式）'}${value.alreadyRunning?'已在运行，未重复启动':'正在运行'}。${value.collecting?'当前正在采集 X；停止会取消本次采集，已发出调用可能产生费用。':'当前空闲，不会自动采集或调用 Grok。'}\n${value.background?'关闭此提示不影响后台运行。可用“停止采集器”退出。':'仍需保持原来的前台窗口开启；要改后台请先停止，再点启动。'}`;
}
export function tradingIntelControlError(error){
  const messages={DESK_INTEL_PAIRING_REJECTED:'运行中的服务拒绝本机配对码。未覆盖配对码，也未结束其他进程。',
    DESK_INTEL_STATUS_UNSUPPORTED:'旧采集器尚不支持后台管理。请先关闭原采集器窗口，再点启动。',
    DESK_INTEL_START_UNVERIFIED:'后台启动尚未确认，请查看状态或本机 collector.log。',
    DESK_INTEL_STOP_UNVERIFIED:'停止尚未确认，请稍后查看状态；没有按进程名强制结束 Node。'};
  return messages[error?.message]??'采集器操作未完成，请查看本机 collector.log；未修改配对码或交易记录。';
}
export function showTradingIntelControlResult(result,{spawnCommand=spawnSync}={}){
  const executable=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  // Message is Unicode environment data, never interpolated or evaluated as code.
  const command="Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($env:FCAT_INTEL_CONTROL_MESSAGE,'FCAT X Collector')";
  const child=spawnCommand(executable,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',command],
    {windowsHide:true,shell:false,env:{...process.env,FCAT_INTEL_CONTROL_MESSAGE:String(result.message)},stdio:'ignore'});
  if(child.error||child.status!==0)throw Error('DESK_INTEL_WINDOW_FAILED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [action,...flags]=process.argv.slice(2);let result;
  try{if(!['start','status','stop'].includes(action)||flags.some(f=>!['--json','--window'].includes(f)))throw Error('DESK_INTEL_ARGUMENT_INVALID');
    const value=await createTradingIntelControl()[action]();result={ok:true,...value,message:tradingIntelControlMessage(value)};
  }catch(error){process.exitCode=1;result={ok:false,error:/^DESK_INTEL_[A-Z_]+$/.test(error.message)?error.message:'DESK_INTEL_CONTROL_FAILED',message:tradingIntelControlError(error)};}
  if(flags.includes('--window'))showTradingIntelControlResult(result);
  else console.log(flags.includes('--json')?JSON.stringify(result):result.message);
}
