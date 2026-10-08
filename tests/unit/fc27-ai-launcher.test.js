import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const helper = path.join(root, 'scripts/browser-inspection/ai-launcher.ps1');
const launcher = path.join(root, 'StartFCAutomationToolAIInspection.ps1');
const quote = value => `'${value.replaceAll("'", "''")}'`;
function powershell(source) {
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `$ErrorActionPreference='Stop'; ${source}`], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('FCAT_LLM_'))),
  });
}
const config = () => ({ schema: 1, protocol: 'chat-completions', endpoint: 'https://relay.example/v1/chat/completions',
  model: 'test-model', outputFormat: 'json', chatTokenField: 'max_tokens', shareAggregates: false,
  apiKey: 'synthetic-test-key', protectedCredential: '' });
function fixture(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fcat-ai-config-test-'));
  try { return run(path.join(dir, 'ai-inspection.json')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe.skipIf(process.platform !== 'win32')('Windows AI launcher and protected local configuration', () => {
  it('matches the exact browser user-data-dir, not a normal or similarly named profile', () => {
    const result = powershell(`. ${quote(helper)};
      $profile='C:\\Users\\Example Name\\.fcat-browser-inspection\\profile';
      $rows=@(
        @{Name='chrome.exe';ProcessId=1;CommandLine='chrome.exe --user-data-dir="C:\\Users\\Example Name\\.fcat-browser-inspection\\profile" --remote-debugging-pipe'},
        @{Name='msedge.exe';ProcessId=2;CommandLine='msedge.exe "--user-data-dir=C:/Users/Example Name/.fcat-browser-inspection/profile/"'},
        @{Name='chrome.exe';ProcessId=3;CommandLine='chrome.exe --user-data-dir="C:\\Users\\Example Name\\.fcat-browser-inspection\\profile-other"'},
        @{Name='chrome.exe';ProcessId=4;CommandLine='chrome.exe --user-data-dir=C:\\Normal\\profile'},
        @{Name='node.exe';ProcessId=5;CommandLine='node.exe --user-data-dir="C:\\Users\\Example Name\\.fcat-browser-inspection\\profile"'},
        @{Name='chrome.exe';ProcessId=6;CommandLine=$null}
      );
      @(Get-FcatProfileOwners -Processes $rows -ProfilePath $profile) | ConvertTo-Json -Compress`);
    expect(JSON.parse(result).map(row => row.ProcessId)).toEqual([1, 2]);
    expect(result).not.toContain('CommandLine');
  });

  it('creates an empty editable template outside the repo without prompting or checking browsers', () => fixture(file => {
    const result = powershell(`function Read-Host { throw 'UNEXPECTED_PROMPT' }; function Get-CimInstance { throw 'UNEXPECTED_BROWSER_CHECK' }; & ${quote(launcher)} -ConfigPath ${quote(file)}`);
    expect(result).toContain('FCAT_AI_CONFIG_CREATED');
    expect(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))).toMatchObject({ schema: 1, endpoint: '', model: '', apiKey: '', shareAggregates: false });
  }));

  it('seals a one-time key, reuses it without prompts and binds it to endpoint and protocol', () => fixture(file => {
    writeFileSync(file, JSON.stringify(config()));
    const result = powershell(`function Read-Host { throw 'UNEXPECTED_PROMPT' }; & ${quote(launcher)} -ConfigPath ${quote(file)} -SaveConfig`);
    expect(result).not.toContain('synthetic-test-key');
    expect(result).toContain('FCAT_AI_CONFIG_SAVED');
    const savedText = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const saved = JSON.parse(savedText);
    expect(savedText).not.toContain('synthetic-test-key');
    expect(saved.apiKey).toBe('');
    expect(saved.protectedCredential.length).toBeGreaterThan(50);
    expect(saved.shareAggregates).toBe(false);
    const checked = powershell(`. ${quote(helper)};
      $config=Read-FcatAiConfig -Path ${quote(file)};
      $key=Get-FcatAiCredential -Config $config;
      if ($key -cne 'synthetic-test-key') { throw 'ROUNDTRIP_FAILED' }; $key=$null;
      $config.endpoint='https://other.example/v1/chat/completions';
      try { $null=Get-FcatAiCredential -Config $config; throw 'SHOULD_HAVE_BLOCKED' } catch { Write-Output $_.Exception.Message }`);
    expect(checked).toContain('FCAT_AI_CREDENTIAL_ENDPOINT_CHANGED');
    expect(checked).not.toContain('synthetic-test-key');
    expect(powershell(`function Read-Host { throw 'UNEXPECTED_PROMPT' }; & ${quote(launcher)} -ConfigPath ${quote(file)} -SaveConfig`))
      .toContain('FCAT_AI_CONFIG_SAVED');
  }));

  it('preserves private ACLs and atomic saves with an incompatible inherited PowerShell module path', () => fixture(file => {
    const moduleRoot = path.join(path.dirname(file), 'modules');
    const incompatible = path.join(moduleRoot, 'Microsoft.PowerShell.Security');
    mkdirSync(incompatible, { recursive: true });
    writeFileSync(path.join(incompatible, 'Microsoft.PowerShell.Security.psd1'),
      "@{ ModuleVersion='99.0'; PowerShellVersion='99.0'; GUID='8062ea41-1772-462c-a1dc-7da9778a1187'; CmdletsToExport=@('Set-Acl') }");
    const modulePath = `${moduleRoot};${path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')}`;
    const result = powershell(`$env:PSModulePath=${quote(modulePath)};
      . ${quote(helper)};
      $seed=New-FcatAiConfig; $seed.endpoint='https://relay.example/v1/chat/completions'; $seed.model='test-model';
      $seed.protectedCredential=Protect-FcatAiCredential -Config $seed -ApiKey 'synthetic-test-key';
      Write-FcatAiConfig -Path ${quote(file)} -Config $seed -CreateOnly;
      & ${quote(launcher)} -ConfigPath ${quote(file)} -SaveConfig;
      $acl=[IO.File]::GetAccessControl(${quote(file)});
      $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));
      $expected=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18');
      if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne 2 -or
          @($rules | Where-Object { $_.IdentityReference.Value -notin $expected -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl' }).Count) { throw 'ACL_CHANGED' };
      Write-Output 'PRIVATE_ACL_OK'`);
    expect(result).toContain('PRIVATE_ACL_OK');
    expect(result).not.toContain('synthetic-test-key');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.apiKey).toBe('');
    expect(saved.protectedCredential.length).toBeGreaterThan(50);
  }));

  it('rejects malformed settings and JSON without printing any raw content', () => fixture(file => {
    for (const value of [
      { ...config(), shareAggregates: 'true' }, { ...config(), protocol: 'unknown' },
      { ...config(), endpoint: 'http://public.example/v1/chat' },
      { ...config(), endpoint: 'https://relay.example/v1/chat?key=synthetic-test-key' },
      { ...config(), outputFormat: 'other' }, { ...config(), extra: 'synthetic-test-key' },
      { ...config(), schema: 2 }, { ...config(), schema: true }, { ...config(), apiKey: 123 },
    ]) {
      writeFileSync(file, JSON.stringify(value));
      const result = powershell(`. ${quote(helper)}; try { $null=Read-FcatAiConfig -Path ${quote(file)}; throw 'SHOULD_HAVE_BLOCKED' } catch { Write-Output $_.Exception.Message }`);
      expect(result).toContain('FCAT_AI_CONFIG_INVALID');
      expect(result).not.toContain('synthetic-test-key');
    }
    writeFileSync(file, '{"apiKey":"synthetic-test-key"');
    const result = powershell(`. ${quote(helper)}; try { $null=Read-FcatAiConfig -Path ${quote(file)} } catch { Write-Output $_.Exception.Message }`);
    expect(result).toContain('FCAT_AI_CONFIG_INVALID_JSON');
    expect(result).not.toContain('synthetic-test-key');
  }), 25000);

  it('checks occupied profiles before decrypting a key and does not close any process', () => fixture(file => {
    writeFileSync(file, JSON.stringify({ ...config(), apiKey: '', protectedCredential: 'invalid-ciphertext' }));
    const result = powershell(`
      function Read-Host { throw 'UNEXPECTED_PROMPT' };
      function Get-CimInstance { @(@{Name='chrome.exe'; ProcessId=123; CommandLine=('chrome.exe --user-data-dir="' + [Environment]::GetFolderPath('UserProfile') + '\\.fcat-browser-inspection\\profile"')}) };
      try { & ${quote(launcher)} -ConfigPath ${quote(file)} } catch { Write-Output $_.Exception.Message }`);
    expect(result).toContain('FCAT_BROWSER_PROFILE_BUSY');
    expect(result).not.toContain('FCAT_AI_CREDENTIAL_UNREADABLE');
    expect(readFileSync(file, 'utf8')).toContain('invalid-ciphertext');
  }));

  it('rejects a config inside the repository before creating a file', () => {
    const result = powershell(`try { & ${quote(launcher)} -ConfigPath ${quote(path.join(root, 'ai-inspection.local.json'))} -SaveConfig } catch { Write-Output $_.Exception.Message }`);
    expect(result).toContain('FCAT_AI_CONFIG_OUTSIDE_REPO_REQUIRED');
  });

  it('checks real Node and installed browser dependencies without opening a browser', () => {
    const result = powershell(`. ${quote(helper)}; function Get-CimInstance { @() };
      Test-FcatAiStartup -Repository ${quote(root)}; Write-Output 'STARTUP_CHECK_OK'`);
    expect(result).toContain('STARTUP_CHECK_OK');
  });

  it('restores the parent environment after an inspection failure without printing the key', () => fixture(file => {
    writeFileSync(file, JSON.stringify(config()));
    const result = powershell(`
      function Read-Host { throw 'UNEXPECTED_PROMPT' };
      function Get-CimInstance { @() };
      function node {
        if ($args[0] -eq '--version') { Write-Output 'v22.0.0'; $global:LASTEXITCODE=0; return };
        if ($args[0] -eq '-e') { $global:LASTEXITCODE=0; return };
        if ($env:FCAT_LLM_API_KEY -cne 'synthetic-test-key') { throw 'KEY_NOT_PASSED' };
        $global:LASTEXITCODE=17
      };
      $env:FCAT_LLM_API_KEY='synthetic-parent-value';
      try { & ${quote(launcher)} -ConfigPath ${quote(file)} } catch { Write-Output $_.Exception.Message };
      if ($env:FCAT_LLM_API_KEY -cne 'synthetic-parent-value') { throw 'ENV_NOT_RESTORED' };
      Write-Output 'ENV_RESTORED'`);
    expect(result).toContain('FCAT_AI_INSPECTION_EXIT_17');
    expect(result).toContain('ENV_RESTORED');
    expect(result).not.toMatch(/synthetic-test-key|synthetic-parent-value/);
  }));
});
