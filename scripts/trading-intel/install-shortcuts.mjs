import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const quote=value=>`'${String(value).replaceAll("'","''")}'`;
export function tradingIntelShortcutSpecs({executable=process.execPath,controller=path.join(import.meta.dirname,'control.mjs')}={}){
  return [['start','启动采集器'],['status','查看采集器状态'],['stop','停止采集器']].map(([action,label])=>{
    // Fixed local command, no keys, user input, arbitrary routes or policy changes.
    const command=`& ${quote(executable)} ${quote(controller)} ${action} --window`;
    // WSH on some Windows code pages corrupts non-ASCII shortcut arguments.
    // PowerShell's documented UTF-16 command form preserves paths and UI text.
    const argumentsText=`-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(command,'utf16le').toString('base64')}`;
    if(argumentsText.length>1000)throw Error('DESK_INTEL_SHORTCUT_PATH_TOO_LONG');
    return {action,label,command,fileName:({start:'Start Collector',status:'Collector Status',stop:'Stop Collector'})[action]+'.lnk',arguments:argumentsText};
  });
}
export function installTradingIntelShortcuts({spawnCommand=spawnSync}={}){
  if(process.platform!=='win32')throw Error('DESK_INTEL_WINDOWS_REQUIRED');
  const target=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const specs=tradingIntelShortcutSpecs();
  // ASCII shortcut paths also work with Windows hosts whose WSH Save uses an ANSI path API.
  const script=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $d=Join-Path ([Environment]::GetFolderPath('Desktop')) 'FCAT X Collector'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $shell=New-Object -ComObject WScript.Shell; `
    +specs.map(s=>`$link=$shell.CreateShortcut((Join-Path $d ${quote(s.fileName)})); $link.TargetPath=${quote(target)}; $link.Arguments=${quote(s.arguments)}; $link.WorkingDirectory=${quote(process.env.SystemRoot??'C:\\Windows')}; $link.Description=${quote('FCAT X Collector: '+s.action+'; on demand only')}; $link.Save();`).join(' ')
    +` Write-Output $d;`;
  const result=spawnCommand(target,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,encoding:'utf8'});
  if(result.error||result.status!==0)throw Error('DESK_INTEL_SHORTCUT_INSTALL_FAILED');return result.stdout.trim();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  console.log(`Desktop shortcuts installed: ${installTradingIntelShortcuts()}`);
}
