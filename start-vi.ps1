# Delegates to shared Windows bootstrap (same behavior as start-vi.bat)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$core = Join-Path $PSScriptRoot "scripts\windows\start-vi-core.ps1"
if (-not (Test-Path $core)) {
    throw "Missing $core"
}

& $core @args
