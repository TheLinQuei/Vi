# Vi Windows bootstrap + dev:up (single source of truth for start-vi.bat / start-vi.ps1)
#Requires -Version 5.1
param(
    [switch] $SkipInstall,
    [switch] $RunTimeEval,
    [ValidateSet("full", "chat", "eval", "ci-smoke")] [string] $LaunchProfile = "full",
    [switch] $Status,
    [switch] $Doctor,
    [switch] $Stop,
    [switch] $Takeover,
    [switch] $Trace
)

$ErrorActionPreference = "Stop"

function Write-Vi {
    param([string] $Message, [ConsoleColor] $Color = "Cyan")
    Write-Host "[Vi] $Message" -ForegroundColor $Color
}
function Write-ViWarn { param([string] $Message) Write-Vi $Message "Yellow" }
function Write-ViErr { param([string] $Message) Write-Vi $Message "Red" }

# Repo root = vi/ (two levels up from scripts/windows/)
$RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot "..") "..")).Path
$RuntimeDir = Join-Path $RepoRoot ".vi-runtime"
$ManifestPath = Join-Path $RuntimeDir "launcher-manifest.json"
$LockPath = Join-Path $RuntimeDir "launcher.lock.json"
$LegacyApiPorts = @(3011, 3012, 3013, 3014)
$DefaultApiPort = 3001
$WebDevPort = 3002

function Initialize-RuntimeDir {
    if (-not (Test-Path $RuntimeDir)) {
        New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    }
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        return (Get-Content $Path -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Write-JsonFile {
    param([string]$Path, [object]$Data)
    $Data | ConvertTo-Json -Depth 14 | Set-Content -Path $Path -Encoding UTF8
}

function Get-ViEnvRaw {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { return $null }
    $lines = Get-Content $Path -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match "^\s*$Key\s*=\s*(.+?)\s*$") {
            return $matches[1].Trim()
        }
    }
    return $null
}

function Get-ViEnvInt {
    param([string]$Path, [string]$Key, [int]$Default)
    $raw = Get-ViEnvRaw -Path $Path -Key $Key
    if (-not $raw) { return $Default }
    if ($raw -match "^\d+$") { return [int]$raw }
    return $Default
}

function Get-ListeningRowsByPorts {
    param([int[]]$Ports)
    try {
        return @(
            Get-NetTCPConnection -State Listen -ErrorAction Stop |
                Where-Object { $Ports -contains $_.LocalPort } |
                Select-Object LocalAddress, LocalPort, OwningProcess
        )
    } catch {
        Write-ViWarn "Could not inspect listening ports: $($_.Exception.Message)"
        return @()
    }
}

function Get-ListeningPidsByPorts {
    param([int[]]$Ports)
    $pidSet = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($row in (Get-ListeningRowsByPorts -Ports $Ports)) {
        [void]$pidSet.Add([int]$row.OwningProcess)
    }
    return @($pidSet)
}

function Get-NodeProcesses {
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Select-Object ProcessId, CommandLine
    )
}

function Test-ViApiCommand {
    param([string]$CommandLine)
    if (-not $CommandLine) { return $false }
    return ($CommandLine -match '(?i)(--import\s+tsx).*(src/server\.ts)\b')
}

function Test-ViWebCommand {
    param([string]$CommandLine)
    if (-not $CommandLine) { return $false }
    return ($CommandLine -match '(?i)(next(\.js)?\s+dev).*?-p\s+3002\b')
}

function Get-ViApiProcesses {
    return @(Get-NodeProcesses | Where-Object { Test-ViApiCommand -CommandLine $_.CommandLine })
}

function Get-ViWebProcesses {
    return @(Get-NodeProcesses | Where-Object { Test-ViWebCommand -CommandLine $_.CommandLine })
}

function Invoke-ViApiPreflightCleanup {
    param([int]$PrimaryApiPort)
    $targetPorts = @($PrimaryApiPort) + $LegacyApiPorts | Select-Object -Unique
    Write-Vi "Preflight cleanup: scanning Vi API listeners on ports $($targetPorts -join ', ') ..."

    $apiByCmd = @{}
    foreach ($p in Get-ViApiProcesses) { $apiByCmd[[int]$p.ProcessId] = $p }

    $listeningPids = Get-ListeningPidsByPorts -Ports $targetPorts
    if ($listeningPids.Count -eq 0 -and $apiByCmd.Count -eq 0) {
        Write-Vi "Preflight cleanup: no prior Vi API processes detected."
        return
    }

    $candidate = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($procId in $listeningPids) { [void]$candidate.Add([int]$procId) }
    foreach ($procId in $apiByCmd.Keys) { [void]$candidate.Add([int]$procId) }

    $killed = New-Object System.Collections.Generic.List[string]
    $skipped = New-Object System.Collections.Generic.List[string]
    foreach ($procId in $candidate) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $cmd = [string]$proc.CommandLine
        if (-not (Test-ViApiCommand -CommandLine $cmd)) {
            $skipped.Add("PID $procId kept (listener but command does not match Vi API): $cmd")
            continue
        }
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            $killed.Add("PID $procId killed: $cmd")
        } catch {
            $skipped.Add("PID $procId failed to kill: $($_.Exception.Message) | $cmd")
        }
    }

    if ($killed.Count -gt 0) {
        Write-Vi "Preflight cleanup killed $($killed.Count) Vi API process(es):" "Green"
        foreach ($line in $killed) { Write-Vi "  - $line" "Green" }
    } else {
        Write-Vi "Preflight cleanup killed 0 Vi API process(es)."
    }
    if ($skipped.Count -gt 0) {
        Write-ViWarn "Preflight cleanup skipped $($skipped.Count) process(es):"
        foreach ($line in $skipped) { Write-ViWarn "  - $line" }
    }
}

function Get-LockData { return Read-JsonFile -Path $LockPath }

function Enter-LauncherLock {
    param([switch]$TakeoverLock)
    Initialize-RuntimeDir
    $existing = Get-LockData
    if ($existing -and $existing.pid) {
        $alive = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.pid)" -ErrorAction SilentlyContinue
        if ($alive -and -not $TakeoverLock) {
            Write-ViErr "Launcher lock exists (PID $($existing.pid), started $($existing.startedAt))."
            Write-ViWarn "Use -Takeover to force takeover."
            exit 2
        }
        if ($alive -and $TakeoverLock) {
            Write-ViWarn "Takeover requested: stale lock process detected (PID $($existing.pid)). Continuing."
        }
    }
    $lock = @{
        pid = $PID
        startedAt = (Get-Date).ToString("o")
        profile = $LaunchProfile
        repoRoot = $RepoRoot
    }
    Write-JsonFile -Path $LockPath -Data $lock
}

function Exit-LauncherLock {
    if (Test-Path $LockPath) {
        try { Remove-Item $LockPath -Force -ErrorAction SilentlyContinue } catch { }
    }
}

function Write-BootManifest {
    param(
        [int]$ApiPort,
        [int]$WebPort,
        [bool]$RunEval,
        [bool]$RunSmoke,
        [string]$Phase,
        [object[]]$Checks
    )
    Initialize-RuntimeDir
    $apiProcs = Get-ViApiProcesses
    $webProcs = Get-ViWebProcesses
    $listeners = Get-ListeningRowsByPorts -Ports (@($ApiPort, $WebPort) + $LegacyApiPorts)
    $manifest = @{
        schemaVersion = 1
        repoRoot = $RepoRoot
        profile = $LaunchProfile
        phase = $Phase
        startedAt = (Get-Date).ToString("o")
        launcherPid = $PID
        apiPort = $ApiPort
        webPort = $WebPort
        runTimeEval = $RunEval
        runSmoke = $RunSmoke
        checks = $Checks
        pids = @{
            api = @($apiProcs | ForEach-Object { [int]$_.ProcessId })
            web = @($webProcs | ForEach-Object { [int]$_.ProcessId })
        }
        listeners = @($listeners)
    }
    Write-JsonFile -Path $ManifestPath -Data $manifest
    Write-Vi "Boot manifest written: $ManifestPath"
}

function Show-Status {
    param([int]$ApiPort, [int]$WebPort)
    Write-Vi "Status: launcher/runtime snapshot"
    $manifest = Read-JsonFile -Path $ManifestPath
    if ($manifest) {
        Write-Vi "Manifest profile=$($manifest.profile) phase=$($manifest.phase) startedAt=$($manifest.startedAt)"
        Write-Vi "Manifest API port=$($manifest.apiPort) WEB port=$($manifest.webPort)"
        Write-Vi "Manifest API pids=$([string]::Join(',', @($manifest.pids.api)))"
        Write-Vi "Manifest WEB pids=$([string]::Join(',', @($manifest.pids.web)))"
    } else {
        Write-ViWarn "No manifest present."
    }

    $rows = Get-ListeningRowsByPorts -Ports (@($ApiPort, $WebPort) + $LegacyApiPorts)
    if ($rows.Count -eq 0) {
        Write-Vi "No listeners on target ports."
    } else {
        Write-Vi "Listeners on target ports:"
        $rows | Format-Table -AutoSize | Out-String | Write-Host
    }
    $api = Get-ViApiProcesses
    if ($api.Count -eq 0) {
        Write-Vi "No Vi API processes detected by command signature."
    } else {
        Write-Vi "Vi API processes:"
        $api | Format-Table -AutoSize | Out-String | Write-Host
    }
    $web = Get-ViWebProcesses
    if ($web.Count -gt 0) {
        Write-Vi "Vi Web dev processes:"
        $web | Format-Table -AutoSize | Out-String | Write-Host
    }
}

function Invoke-Doctor {
    param(
        [string]$EnvFile,
        [int]$ApiPort,
        [int]$WebPort
    )
    $checks = New-Object System.Collections.Generic.List[object]
    $add = {
        param([string]$Name, [bool]$Ok, [string]$Detail)
        $checks.Add([ordered]@{ name = $Name; ok = $Ok; detail = $Detail })
        if ($Ok) { Write-Vi "Doctor OK: $Name - $Detail" "Green" } else { Write-ViErr "Doctor FAIL: $Name - $Detail" }
    }

    & $add "node-on-path" ([bool](Get-Command node -ErrorAction SilentlyContinue)) "node executable lookup"
    & $add "docker-on-path" ([bool](Get-Command docker -ErrorAction SilentlyContinue)) "docker executable lookup"
    & $add "env-file" (Test-Path $EnvFile) ".env present"
    $dbUrl = Get-ViEnvRaw -Path $EnvFile -Key "DATABASE_URL"
    & $add "database-url" ([bool]$dbUrl) "DATABASE_URL present"
    $provider = Get-ViEnvRaw -Path $EnvFile -Key "VI_PROVIDER"
    if (-not $provider) { $provider = "openai" }
    & $add "provider-selected" ($provider -match '^(openai|xai|gemini)$') "VI_PROVIDER=$provider"

    $rows = Get-ListeningRowsByPorts -Ports (@($ApiPort, $WebPort) + $LegacyApiPorts)
    $conflicts = @()
    foreach ($row in $rows) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($row.OwningProcess)" -ErrorAction SilentlyContinue
        $cmd = [string]$proc.CommandLine
        $isNextServer = ($cmd -match '(?i)next[\\\/]dist[\\\/]server[\\\/]lib[\\\/]start-server\.js')
        $allowed = (Test-ViApiCommand -CommandLine $cmd) -or
            (Test-ViWebCommand -CommandLine $cmd) -or
            ($isNextServer -and [int]$row.LocalPort -eq $WebPort)
        if (-not $allowed) {
            $conflicts += "port $($row.LocalPort) pid $($row.OwningProcess) cmd=$cmd"
        }
    }
    & $add "port-conflicts" ($conflicts.Count -eq 0) ($(if ($conflicts.Count -eq 0) { "none" } else { $conflicts -join " | " }))

    return ,($checks.ToArray())
}

function Invoke-Stop {
    param([int]$ApiPort)
    Write-Vi "Stopping Vi managed runtime..."
    $manifest = Read-JsonFile -Path $ManifestPath
    $stopped = New-Object System.Collections.Generic.List[string]
    $failed = New-Object System.Collections.Generic.List[string]

    if ($manifest -and $manifest.pids) {
        $pidList = @($manifest.pids.api) + @($manifest.pids.web) | Where-Object { $_ } | Select-Object -Unique
        foreach ($id in $pidList) {
            try {
                Stop-Process -Id ([int]$id) -Force -ErrorAction Stop
                $stopped.Add("PID $id from manifest")
            } catch {
                $failed.Add("PID $id (manifest): $($_.Exception.Message)")
            }
        }
    }

    Invoke-ViApiPreflightCleanup -PrimaryApiPort $ApiPort

    if ($stopped.Count -gt 0) {
        Write-Vi "Stopped process(es):" "Green"
        foreach ($line in $stopped) { Write-Vi "  - $line" "Green" }
    }
    if ($failed.Count -gt 0) {
        Write-ViWarn "Could not stop some process(es):"
        foreach ($line in $failed) { Write-ViWarn "  - $line" }
    }
    if (Test-Path $ManifestPath) { Remove-Item $ManifestPath -Force -ErrorAction SilentlyContinue }
    Exit-LauncherLock
    Write-Vi "Stop complete."
}

Set-Location $RepoRoot
Write-Vi "Repo: $RepoRoot"
Write-Vi "Flags: SkipInstall=$($SkipInstall.IsPresent) RunTimeEval=$($RunTimeEval.IsPresent) Profile=$LaunchProfile Trace=$($Trace.IsPresent)"

$envFile = Join-Path $RepoRoot ".env"
$exampleFile = Join-Path $RepoRoot ".env.example"
if (-not (Test-Path $envFile)) {
    if (Test-Path $exampleFile) {
        Copy-Item $exampleFile $envFile
        Write-ViWarn "Created .env from .env.example — add API keys before chatting (model calls need keys)."
    } else {
        Write-ViErr "Missing .env and no .env.example."
        exit 1
    }
}

$apiPort = Get-ViEnvInt -Path $envFile -Key "API_PORT" -Default $DefaultApiPort

if ($Status) {
    Show-Status -ApiPort $apiPort -WebPort $WebDevPort
    exit 0
}
if ($Doctor) {
    $checks = Invoke-Doctor -EnvFile $envFile -ApiPort $apiPort -WebPort $WebDevPort
    $hasFail = ($checks | Where-Object { -not $_.ok }).Count -gt 0
    if ($hasFail) { exit 3 }
    exit 0
}
if ($Stop) {
    Invoke-Stop -ApiPort $apiPort
    exit 0
}

Enter-LauncherLock -TakeoverLock:$Takeover

try {
    # --- Node ---
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-ViErr "Node.js not found on PATH."
        Write-ViWarn "Install: winget install OpenJS.NodeJS.LTS"
        exit 1
    }
    $nodeVer = (node -v) -replace "^v", ""
    $nodeMajor = [int]($nodeVer -split "\.")[0]
    if ($nodeMajor -lt 18) {
        Write-ViWarn "Node $nodeVer is below 18; Vi expects Node 18+."
    }
    $nodeBin = Split-Path -Parent (Get-Command node).Source
    if ($env:Path -notlike "*$nodeBin*") {
        $env:Path = "$nodeBin;$env:Path"
        Write-Vi "Prepended Node directory to PATH for this session."
    }

    # --- Docker ---
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-ViErr "Docker CLI not found. dev:up needs Postgres via Docker."
        exit 1
    }
    $dockerInfo = & docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-ViErr "Docker daemon is not running."
        Write-Vi "Docker said: $($dockerInfo | Out-String)"
        exit 1
    }
    Write-Vi "Docker daemon OK."

    # --- pnpm ---
    $useNpxPnpm = $false
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Vi "pnpm not on PATH — trying Corepack..."
        try { & corepack enable 2>&1 | Out-Null } catch { }
        try { & corepack prepare pnpm@9.15.4 --activate 2>&1 | Out-Null } catch { }
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Vi "Using npx pnpm@9.15.4."
        $useNpxPnpm = $true
    } else {
        Write-Vi "pnpm on PATH: $((Get-Command pnpm).Source)"
    }
    function Invoke-ViPnpm {
        param([Parameter(ValueFromRemainingArguments = $true)][string[]] $CommandArgs)
        if ($useNpxPnpm) { & npx --yes pnpm@9.15.4 @CommandArgs } else { & pnpm @CommandArgs }
    }

    # --- profile resolution ---
    $runEval = $false
    $runPhase2Eval = $false
    $runSmoke = $false
    switch ($LaunchProfile) {
        "chat" { $runEval = $false; $runPhase2Eval = $false; $runSmoke = $false }
        "eval" { $runEval = $true; $runPhase2Eval = $true; $runSmoke = $true }
        "full" { $runEval = $true; $runPhase2Eval = $true; $runSmoke = $true }
        "ci-smoke" { $runEval = $false; $runPhase2Eval = $true; $runSmoke = $true }
    }
    if ($RunTimeEval) { $runEval = $true; $runPhase2Eval = $true }
    $apiBaseUrl = "http://127.0.0.1:$apiPort"

    # --- preflight ---
    $doctorChecks = Invoke-Doctor -EnvFile $envFile -ApiPort $apiPort -WebPort $WebDevPort
    $doctorFail = ($doctorChecks | Where-Object { -not $_.ok }).Count -gt 0
    if ($doctorFail) {
        Write-ViErr "Doctor checks failed; aborting start."
        Write-BootManifest -ApiPort $apiPort -WebPort $WebDevPort -RunEval $runEval -RunSmoke $runSmoke -Phase "doctor_failed" -Checks $doctorChecks
        exit 3
    }

    Invoke-ViApiPreflightCleanup -PrimaryApiPort $apiPort

    # --- dependencies ---
    if (-not $SkipInstall) {
        $nm = Join-Path $RepoRoot "node_modules"
        if (-not (Test-Path $nm)) {
            Write-Vi "Running pnpm install (first time)..."
            Invoke-ViPnpm install
            if ($LASTEXITCODE -ne 0) {
                Write-ViErr "pnpm install failed (exit $LASTEXITCODE)."
                exit $LASTEXITCODE
            }
        }
    } else {
        Write-Vi "SkipInstall enabled: dependency install step skipped."
    }

    Write-BootManifest -ApiPort $apiPort -WebPort $WebDevPort -RunEval $runEval -RunSmoke $runSmoke -Phase "launching" -Checks $doctorChecks
    Write-Vi "Starting profile '$LaunchProfile': Postgres check, db:setup, API + Web..."
    Write-Vi "UI http://localhost:$WebDevPort  |  API $apiBaseUrl"
    Write-Vi "Press Ctrl+C to stop. (Docker container vi-postgres keeps running.)"
    Write-Host ""

    # readiness + smoke sidecar
    $traceOn = if ($Trace) { "true" } else { "false" }
    $readinessScript = @"
`$ErrorActionPreference = 'Stop'
`$apiBaseUrl = "$apiBaseUrl"
`$manifestPath = "$ManifestPath"
`$runSmoke = "$($runSmoke.ToString().ToLower())" -eq "true"
`$runEval = "$($runEval.ToString().ToLower())" -eq "true"
`$runPhase2Eval = "$($runPhase2Eval.ToString().ToLower())" -eq "true"
`$trace = "$traceOn" -eq "true"
`$deadline = (Get-Date).AddMinutes(3)
`$ready = `$false
Write-Host "[Vi] Readiness sidecar: waiting for API `$apiBaseUrl ..." -ForegroundColor DarkCyan
while ((Get-Date) -lt `$deadline) {
  try {
    `$resp = Invoke-WebRequest -Uri "`$apiBaseUrl/chat/messages?sessionId=health-check" -Method Get -UseBasicParsing -TimeoutSec 2
    if (`$resp.StatusCode -ge 200 -and `$resp.StatusCode -lt 500) { `$ready = `$true; break }
  } catch { }
  Start-Sleep -Milliseconds 1200
}
if (-not `$ready) {
  Write-Host "[Vi] Readiness sidecar: API not reachable within 3 minutes." -ForegroundColor Yellow
  exit 0
}
Write-Host "[Vi] Readiness sidecar: API reachable." -ForegroundColor Green

if (`$trace) {
  `$env:VI_DEBUG_CONTEXT = "true"
  Write-Host "[Vi] Trace mode requested: enable VI_DEBUG_CONTEXT in runtime environment manually if needed." -ForegroundColor Yellow
}

if (`$runSmoke) {
  Write-Host "[Vi] Running 77EZ smoke probes..." -ForegroundColor Cyan
  `$smoke = @()
  try {
    `$chat1 = Invoke-RestMethod -Uri "`$apiBaseUrl/chat" -Method Post -ContentType "application/json" -Body (@{ message = "Do you want that?" } | ConvertTo-Json)
    `$okUnified = [bool](
      `$chat1.unifiedState -and
      `$chat1.unifiedState.version -eq 2 -and
      `$chat1.unifiedState.alignedInterpretation -and
      `$chat1.unifiedState.stance -and
      `$chat1.unifiedState.relational
    )
    `$reply = [string]`$chat1.reply
    `$forbidden = [bool](`$reply -match "(?i)not (a )?matter of wanting|i don't have wants|not about wanting")
    `$smoke += @{ name="77ez-phase2-unified-authority"; ok=`$okUnified; detail="version=2 + alignedInterpretation+stance+relational present" }
    `$smoke += @{ name="77ez-wants-behavior"; ok=(-not `$forbidden); detail="no legacy wanting deflection" }
  } catch {
    `$smoke += @{ name="77ez-chat-probe"; ok=`$false; detail=$_.Exception.Message }
  }
  foreach (`$s in `$smoke) {
    if (`$s.ok) { Write-Host "[Vi] Smoke OK: `$(`$s.name) - `$(`$s.detail)" -ForegroundColor Green }
    else { Write-Host "[Vi] Smoke FAIL: `$(`$s.name) - `$(`$s.detail)" -ForegroundColor Yellow }
  }
}

if (`$runPhase2Eval) {
  Write-Host "[Vi] Running Phase 2 eval sidecar..." -ForegroundColor Cyan
  `$env:PHASE2_EVAL_API_BASE_URL = "`$apiBaseUrl"
  pnpm eval:phase2
}

if (`$runEval) {
  Write-Host "[Vi] Running Time Cathedral eval sidecar..." -ForegroundColor Cyan
  `$env:TIME_EVAL_API_BASE_URL = "`$apiBaseUrl"
  pnpm eval:time-cathedral
}
"@
    Start-Process -FilePath powershell.exe `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $readinessScript) `
      -WorkingDirectory $RepoRoot | Out-Null
    Write-Vi "Readiness/Smoke sidecar launched."

    if ($LaunchProfile -eq "ci-smoke") {
        Write-Vi "Profile ci-smoke selected: not starting long-running dev stack."
        Write-Vi "Use -Profile full/chat/eval to run dev servers."
        Write-BootManifest -ApiPort $apiPort -WebPort $WebDevPort -RunEval $runEval -RunSmoke $runSmoke -Phase "ci_smoke_only" -Checks $doctorChecks
        exit 0
    }

    Invoke-ViPnpm dev:up
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        Write-ViErr "dev:up failed (exit $exit)."
        if ($useNpxPnpm) {
            Write-ViWarn "Optional: Admin PowerShell once — corepack enable."
        }
        exit $exit
    }
} finally {
    Exit-LauncherLock
}
