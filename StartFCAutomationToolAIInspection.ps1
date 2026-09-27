[CmdletBinding()]
param(
    [ValidateSet('chat-completions', 'responses', 'gemini')] [string]$Protocol,
    [string]$Endpoint, [string]$Model,
    [ValidateSet('json', 'schema', 'text')] [string]$OutputFormat,
    [ValidateSet('max_tokens', 'max_completion_tokens')] [string]$ChatTokenField,
    [string]$ConfigPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FCAutomationTool\ai-inspection.json'),
    [switch]$SaveConfig, [switch]$CheckOnly, [switch]$SetKey
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/browser-inspection/ai-launcher.ps1')
if ($CheckOnly -and ($SaveConfig -or $SetKey)) { throw 'FCAT_AI_OPTIONS_INVALID: CheckOnly cannot save configuration or change the key.' }
$ConfigPath = Resolve-FcatAiConfigPath -Path $ConfigPath -Repository $PSScriptRoot
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    if ($CheckOnly) { throw 'FCAT_AI_CONFIG_MISSING: Run without CheckOnly to create the template.' }
    Write-FcatAiConfig -Path $ConfigPath -Config (New-FcatAiConfig) -CreateOnly
    Write-Host "FCAT_AI_CONFIG_CREATED: $ConfigPath"
    Write-Host 'Fill endpoint, model and apiKey once, then run again. shareAggregates defaults to false.'
    return
}
$config = Read-FcatAiConfig -Path $ConfigPath
foreach ($name in @('Protocol','Endpoint','Model','OutputFormat','ChatTokenField')) {
    if ($PSBoundParameters.ContainsKey($name)) { $config[($name.Substring(0,1).ToLowerInvariant()+$name.Substring(1))] = $PSBoundParameters[$name] }
}
Assert-FcatAiConfig -Config $config
if (-not $config.endpoint -or -not $config.model) { throw 'FCAT_AI_CONFIG_INCOMPLETE: Fill endpoint and model in the local JSON file.' }
# Save-only does not need a browser, a free profile, or any network.
if (-not $SaveConfig) { Test-FcatAiStartup -Repository $PSScriptRoot }
$secretKey = $null
$secureKey = $null
$pointer = [IntPtr]::Zero
$previous = @{}
$variables = @('FCAT_LLM_ENABLED','FCAT_LLM_PROTOCOL','FCAT_LLM_ENDPOINT','FCAT_LLM_MODEL',
    'FCAT_LLM_FORMAT','FCAT_LLM_CHAT_TOKEN_FIELD','FCAT_LLM_SHARE_AGGREGATES','FCAT_LLM_KEY_ENDPOINT','FCAT_LLM_API_KEY')
try {
    if ($SetKey) {
        $secureKey = Read-Host 'API key (hidden; saved with Windows protection)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        $config.apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        Assert-FcatAiConfig -Config $config
    }
    $secretKey = Get-FcatAiCredential -Config $config
    if ($CheckOnly) { Write-Host 'FCAT_AI_CHECK_OK: No browser, writes or model request.'; return }
    if ($SaveConfig -or $config.apiKey -or $PSBoundParameters.Keys.Where({ $_ -in @('Protocol','Endpoint','Model','OutputFormat','ChatTokenField') }).Count) {
        $config.protectedCredential = Protect-FcatAiCredential -Config $config -ApiKey $secretKey
        $config.apiKey = ''
        Write-FcatAiConfig -Path $ConfigPath -Config $config
        Write-Host "FCAT_AI_CONFIG_SAVED: Windows current-user protected credential in $ConfigPath"
    }
    if ($SaveConfig) { return }
    foreach ($name in $variables) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    [Environment]::SetEnvironmentVariable('FCAT_LLM_API_KEY',$secretKey,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_KEY_ENDPOINT',$config.endpoint,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_ENABLED','true','Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_PROTOCOL',$config.protocol,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_ENDPOINT',$config.endpoint,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_MODEL',$config.model,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_FORMAT',$config.outputFormat,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_CHAT_TOKEN_FIELD',$config.chatTokenField,'Process')
    [Environment]::SetEnvironmentVariable('FCAT_LLM_SHARE_AGGREGATES',$config.shareAggregates.ToString().ToLowerInvariant(),'Process')
    Write-Host 'Optional AI inspection. Model requests may incur charges; starting the browser does not call a model.'
    Write-Host "Puzzle aggregate sharing enabled: $($config.shareAggregates). No buying, moving, filling, saving or submitting."
    Write-Host 'ai-test tests the connection without EA login; puzzle-ai <set-id> <challenge-id> needs login; q closes.'
    & node (Join-Path $PSScriptRoot 'scripts/browser-inspection/run.mjs') --agent --with-extensions
    if ($LASTEXITCODE -ne 0) { throw ("FCAT_AI_INSPECTION_EXIT_{0}: See the preceding startup stage. Configuration is retained; no automatic model retry." -f $LASTEXITCODE) }
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secureKey) { $secureKey.Dispose() }
    $secretKey = $null
    $config.apiKey = ''
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
