@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "CORE=%~dp0scripts\deploy-vi-api.ps1"
if not exist "%CORE%" (
  echo [Vi] Missing scripts\deploy-vi-api.ps1
  pause
  exit /b 1
)

rem Prefer PowerShell 7 (pwsh); fall back to Windows PowerShell 5.1
set "PSX=%ProgramFiles%\PowerShell\7\pwsh.exe"
if exist "%PSX%" (
  "%PSX%" -NoProfile -ExecutionPolicy Bypass -File "%CORE%" %*
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CORE%" %*
)

set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo [Vi] Update deploy failed with code %EC%
  pause
)
exit /b %EC%
