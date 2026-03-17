@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM ClawNet — Windows CMD Installer (delegates to PowerShell)
REM ============================================================================
REM Usage:
REM   curl -fsSL https://clawnetd.com/setup.cmd -o setup.cmd && setup.cmd && del setup.cmd
REM
REM Or run locally:
REM   scripts\setup.cmd

set "INSTALL_PS1_URL=https://clawnetd.com/setup.ps1"

echo.
echo   ClawNet Setup (Windows CMD)
echo.

REM Check if running from local repo (scripts\setup.ps1 exists)
set "LOCAL_PS1=%~dp0setup.ps1"
if exist "%LOCAL_PS1%" (
    echo [info]  Found local setup.ps1, using it...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_PS1%"
    set "RESULT=%ERRORLEVEL%"
    if %RESULT% neq 0 exit /b %RESULT%
    exit /b 0
)

REM Check curl is available
curl --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [error] curl is required but not available. >&2
    echo         Use PowerShell instead: iwr -useb https://clawnetd.com/setup.ps1 ^| iex >&2
    exit /b 1
)

REM Check PowerShell is available
powershell -NoProfile -Command "$PSVersionTable.PSVersion.Major" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [error] PowerShell is required but not available. >&2
    echo         Install PowerShell or use: iwr -useb https://clawnetd.com/setup.ps1 ^| iex >&2
    exit /b 1
)

REM Download setup.ps1 to temp
set "TMP_PS1=%TEMP%\clawnet-setup.ps1"

echo [info]  Downloading setup.ps1...
curl -fsSL "%INSTALL_PS1_URL%" -o "%TMP_PS1%"
if %ERRORLEVEL% neq 0 (
    echo [error] Failed to download setup.ps1 >&2
    exit /b 1
)

REM Execute via PowerShell with bypass
echo [info]  Delegating to PowerShell...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS1%"
set "RESULT=%ERRORLEVEL%"

REM Cleanup
del /f "%TMP_PS1%" >nul 2>&1

if %RESULT% neq 0 exit /b %RESULT%
exit /b 0
