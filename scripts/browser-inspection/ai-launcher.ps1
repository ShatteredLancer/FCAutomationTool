# Windows-only helpers. Never print config values, command lines or credentials.
function New-FcatAiConfig {
    [ordered]@{ schema = 1; protocol = 'chat-completions'; endpoint = ''; model = ''; outputFormat = 'json';
        chatTokenField = 'max_tokens'; shareAggregates = $false; apiKey = ''; protectedCredential = '' }
}
function Resolve-FcatAiConfigPath {
    param([string]$Path, [string]$Repository)
    try { $full = [IO.Path]::GetFullPath($Path); $repo = [IO.Path]::GetFullPath($Repository).TrimEnd('\', '/') } catch { throw 'FCAT_AI_CONFIG_PATH_INVALID' }
    if ($full -ieq $repo -or $full.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'FCAT_AI_CONFIG_OUTSIDE_REPO_REQUIRED' }
    $ancestor = $full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'FCAT_AI_CONFIG_PATH_INVALID: Reparse points are not supported.' }
        }
        $ancestor = Split-Path -Parent $ancestor
    }
    $full
}
function Assert-FcatAiConfig {
    param([object]$Config)
    $fields = @(New-FcatAiConfig).Keys
    if ($Config -isnot [Collections.IDictionary] -or $Config.Count -ne $fields.Count) { throw 'FCAT_AI_CONFIG_INVALID: Unexpected fields or schema.' }
    foreach ($field in $Config.Keys) { if ($field -cnotin $fields) { throw 'FCAT_AI_CONFIG_INVALID: Unexpected fields or schema.' } }
    if ($Config.schema -isnot [int] -or $Config.schema -ne 1 -or $Config.shareAggregates -isnot [bool]) { throw 'FCAT_AI_CONFIG_INVALID: schema and shareAggregates must have documented types.' }
    foreach ($field in @('protocol','endpoint','model','outputFormat','chatTokenField','apiKey','protectedCredential')) {
        if ($Config[$field] -isnot [string]) { throw 'FCAT_AI_CONFIG_INVALID: Unexpected field type.' }
    }
    if ($Config.protocol -cnotin @('chat-completions','responses','gemini') -or $Config.outputFormat -cnotin @('json','schema','text') -or $Config.chatTokenField -cnotin @('max_tokens','max_completion_tokens')) { throw 'FCAT_AI_CONFIG_INVALID: Unknown protocol or output mode.' }
    if ($Config.model -and $Config.model -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$') { throw 'FCAT_AI_CONFIG_INVALID: Invalid model.' }
    if (($Config.apiKey -and $Config.apiKey -cnotmatch '^[\x21-\x7e]{1,512}$') -or $Config.protectedCredential.Length -gt 32768) { throw 'FCAT_AI_CONFIG_INVALID: Invalid credential.' }
    if ($Config.endpoint) {
        try {
            if ($Config.endpoint.Length -gt 2048 -or $Config.endpoint -match '[\s\\]') { throw 'invalid' }
            $template = $Config.endpoint.Contains('{model}')
            if ($template -and ($Config.protocol -cne 'gemini' -or -not $Config.endpoint.EndsWith('/models/{model}:generateContent'))) { throw 'invalid' }
            if ($Config.endpoint.Replace('{model}', '') -match '[{}]') { throw 'invalid' }
            $endpoint = $Config.endpoint.Replace('{model}', [Uri]::EscapeDataString($Config.model)); $uri = [Uri]$endpoint
            if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -eq '/' -or
                ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -in @('localhost','127.0.0.1','[::1]')))) { throw 'invalid' }
            if ($Config.protocol -eq 'gemini' -and $Config.model -and -not $uri.AbsolutePath.EndsWith('/models/' + [Uri]::EscapeDataString($Config.model) + ':generateContent')) { throw 'invalid' }
        } catch { throw 'FCAT_AI_CONFIG_INVALID: Use a full HTTPS (or loopback HTTP) URL without credentials, query or fragment.' }
    }
}
function Read-FcatAiConfig {
    param([string]$Path)
    try { if ((Get-Item -LiteralPath $Path).Length -gt 65536) { throw 'oversize' }; $parsed = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'FCAT_AI_CONFIG_INVALID_JSON: Check syntax and file size; raw content was not printed.' }
    if ($parsed -isnot [pscustomobject]) { throw 'FCAT_AI_CONFIG_INVALID: Expected a JSON object.' }
    $config = [ordered]@{}; foreach ($property in $parsed.PSObject.Properties) { $config[$property.Name] = $property.Value }
    Assert-FcatAiConfig -Config $config; $config
}
function Protect-FcatAiCredential {
    param([object]$Config, [string]$ApiKey)
    $bytes = $null; $payload = $null
    try {
        Add-Type -AssemblyName System.Security
        $payload = @{ schema = 1; endpoint = $Config.endpoint; protocol = $Config.protocol; apiKey = $ApiKey } | ConvertTo-Json -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
        [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))
    } catch { throw 'FCAT_AI_CREDENTIAL_PROTECTION_FAILED: Existing configuration was not intentionally replaced.' }
    finally { if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }; $payload = $null }
}
function Get-FcatAiCredential {
    param([object]$Config)
    if ($Config.apiKey) { return $Config.apiKey }
    if (-not $Config.protectedCredential) { throw 'FCAT_AI_CREDENTIAL_MISSING: Fill apiKey once or use -SetKey for hidden input.' }
    $bytes = $null; $credential = $null
    try {
        Add-Type -AssemblyName System.Security
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Config.protectedCredential), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $credential = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
        if ($credential.schema -ne 1 -or $credential.apiKey -isnot [string] -or $credential.apiKey -cnotmatch '^[\x21-\x7e]{1,512}$') { throw 'invalid' }
    } catch { throw 'FCAT_AI_CREDENTIAL_UNREADABLE: Use the original Windows account/computer, or enter a replacement apiKey.' }
    finally { if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) } }
    if ($credential.endpoint -cne $Config.endpoint -or $credential.protocol -cne $Config.protocol) { throw 'FCAT_AI_CREDENTIAL_ENDPOINT_CHANGED: The key will not be sent to a changed endpoint/protocol.' }
    $credential.apiKey
}
function Set-FcatPrivateFileAcl {
    param([string]$Path)
    $acl = New-Object Security.AccessControl.FileSecurity; $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18'); $acl.SetOwner($user); $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($user,'FullControl','Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($system,'FullControl','Allow')))
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Write-FcatAiConfig {
    param([string]$Path, [object]$Config, [switch]$CreateOnly)
    if ($Config.apiKey) { throw 'FCAT_AI_PLAINTEXT_WRITE_BLOCKED' }
    $temporary = $null
    $stage = 'prepare'
    try {
        $parent = Split-Path -Parent $Path; [IO.Directory]::CreateDirectory($parent) | Out-Null
        $temporary = Join-Path $parent ('ai-config-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        $stream = [IO.File]::Open($temporary,[IO.FileMode]::CreateNew); $stream.Dispose(); Set-FcatPrivateFileAcl -Path $temporary
        [IO.File]::WriteAllText($temporary,($Config | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
        $stage = 'replace'
        # PowerShell 5 converts $null string arguments to empty strings; use an
        # explicit null string so .NET creates no backup (which could hold a key).
        if (-not $CreateOnly -and (Test-Path -LiteralPath $Path -PathType Leaf)) { [IO.File]::Replace($temporary,$Path,[NullString]::Value) }
        else { [IO.File]::Move($temporary,$Path) }
        $temporary = $null
    } catch { throw "FCAT_AI_CONFIG_SAVE_FAILED: Stage $stage. Check local file permissions; no non-atomic overwrite was attempted." }
    finally { if ($temporary -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Get-FcatProfileOwners {
    param([object[]]$Processes, [string]$ProfilePath)
    $expected = [IO.Path]::GetFullPath($ProfilePath.Replace('/', '\')).TrimEnd('\')
    $pattern = '(?i)(?:^|\s)(?:"--user-data-dir=(?<whole>[^"]+)"|--user-data-dir(?:=|\s+)(?:"(?<quoted>[^"]+)"|(?<bare>[^\s"]+)))(?=\s|$)'
    foreach ($process in $Processes) {
        if ($process.Name -notin @('chrome.exe','msedge.exe') -or -not $process.CommandLine) { continue }
        foreach ($match in [regex]::Matches([string]$process.CommandLine,$pattern)) {
            $value = @('whole','quoted','bare') | ForEach-Object { $match.Groups[$_].Value } | Where-Object { $_ } | Select-Object -First 1
            try { $candidate = [IO.Path]::GetFullPath($value.Replace('/', '\')).TrimEnd('\') } catch { continue }
            if ($candidate.Equals($expected,[StringComparison]::OrdinalIgnoreCase)) { [pscustomobject]@{ Name=[string]$process.Name; ProcessId=[int]$process.ProcessId }; break }
        }
    }
}
function Test-FcatAiStartup {
    param([string]$Repository)
    try { $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -OperationTimeoutSec 10 -ErrorAction Stop) }
    catch { throw 'FCAT_BROWSER_PROFILE_CHECK_FAILED: Could not inspect browser ownership; no credential was loaded.' }
    $profile = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.fcat-browser-inspection\profile'
    $owners = @(Get-FcatProfileOwners -Processes $processes -ProfilePath $profile)
    if ($owners.Count) { throw ("FCAT_BROWSER_PROFILE_BUSY: Dedicated inspection browser PID(s) {0}; close that session with q. No credential was loaded or process closed." -f (($owners | ForEach-Object { $_.ProcessId }) -join ', ')) }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'FCAT_NODE_MISSING' }
    $version = & node --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(22|23|24)\.') { throw 'FCAT_NODE_UNSUPPORTED: Use Node 22 through 24.' }
    $dependency = Join-Path $Repository 'tools/browser-inspection/package.json'
    & node -e "try { require('node:module').createRequire(process.argv[1])('playwright-core'); } catch { process.exitCode=1; }" $dependency
    if ($LASTEXITCODE -ne 0) { throw 'FCAT_BROWSER_DEPENDENCY_MISSING: Run npm ci --prefix tools/browser-inspection.' }
    $browsers = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'))
    if (-not @($browsers | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count) { throw 'FCAT_BROWSER_MISSING: Install Chrome or Edge.' }
}
