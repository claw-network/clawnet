# ============================================================================
# ClawNet — One-Click Local Development Setup (Windows PowerShell)
# ============================================================================
# Usage:
#   iwr -useb https://clawnetd.com/setup.ps1 | iex
#
# Or run locally:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#
# What it does:
#   1. Checks prerequisites (Node.js >=20, pnpm >=10, git)
#   2. Clones the ClawNet repo (or pulls if already cloned)
#   3. Installs dependencies via pnpm
#   4. Generates passphrase, API key, and optional EVM signer key
#   5. Creates .env with generated values
#   6. Builds workspace packages
#   7. Installs and starts ClawNet as a Windows service (NSSM)
# ============================================================================

$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────

function Write-Info  { param([string]$Msg) Write-Host "[info]  $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host "[error] $Msg" -ForegroundColor Red; exit 1 }

# ── Config ────────────────────────────────────────────────────────────

$RepoUrl    = "https://github.com/claw-network/clawnet.git"
$InstallDir = if ($env:CLAWNET_INSTALL_DIR) { $env:CLAWNET_INSTALL_DIR } else { Join-Path $env:USERPROFILE "clawnet" }
$Branch     = if ($env:CLAWNET_BRANCH) { $env:CLAWNET_BRANCH } else { "main" }
$Network    = if ($env:CLAWNET_NETWORK) { $env:CLAWNET_NETWORK } else { "testnet" }
$NodeMin    = 20
$NodeMax    = 24
$PnpmMin    = 10
$DataDir    = Join-Path $env:USERPROFILE ".clawnet"

Write-Host ""
Write-Host "  ClawNet Local Setup (Windows)" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Prerequisites ────────────────────────────────────────────

Write-Info "Checking prerequisites..."

# Node.js
try {
    $nodeVersion = (node -v 2>$null)
} catch {
    $nodeVersion = $null
}
if (-not $nodeVersion) {
    Write-Fail "Node.js not found. Install Node.js >= $NodeMin first: https://nodejs.org"
}
$nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($nodeMajor -lt $NodeMin -or $nodeMajor -gt $NodeMax) {
    Write-Fail "Node.js $nodeVersion is not supported. Need >= $NodeMin < $($NodeMax + 1). Use: fnm install $NodeMin"
}
Write-Ok "Node.js $nodeVersion"

# pnpm
try {
    $pnpmVersion = (pnpm -v 2>$null)
} catch {
    $pnpmVersion = $null
}
if (-not $pnpmVersion) {
    Write-Info "pnpm not found, installing via corepack..."
    corepack enable
    corepack prepare pnpm@latest --activate
    $pnpmVersion = (pnpm -v)
}
$pnpmMajor = [int]($pnpmVersion -split '\.')[0]
if ($pnpmMajor -lt $PnpmMin) {
    Write-Fail "pnpm $pnpmVersion is too old. Need >= $PnpmMin. Run: corepack prepare pnpm@latest --activate"
}
Write-Ok "pnpm v$pnpmVersion"

# git
try {
    $null = Get-Command git -ErrorAction Stop
} catch {
    Write-Fail "git not found. Install Git for Windows: https://git-scm.com/download/win"
}
$gitVer = (git --version) -replace 'git version ', ''
Write-Ok "git $gitVer"

# ── Step 2: Clone or update repo ─────────────────────────────────────

if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Info "Existing repo found at $InstallDir, pulling latest..."
    git -C $InstallDir pull --ff-only
} else {
    Write-Info "Cloning ClawNet ($Branch) to $InstallDir..."
    git clone --depth 1 --branch $Branch $RepoUrl $InstallDir
}
Write-Ok "Repo ready at $InstallDir"

Set-Location $InstallDir

# ── Step 3: Install dependencies ─────────────────────────────────────

Write-Info "Installing dependencies (this may take a minute)..."
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Write-Fail "pnpm install failed" }
Write-Ok "Dependencies installed"

# ── Step 4: Generate secrets & .env ───────────────────────────────────

if (Test-Path ".env") {
    $backup = ".env.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
    Write-Warn ".env already exists, backing up to $backup"
    Copy-Item ".env" $backup
}

Write-Info "Generating secrets..."

# Generate passphrase (64 hex chars)
$passphrase = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Generate API key (64 hex chars)
$apiKey = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Generate EVM private key
$evmGenScript = @"
import { Wallet } from 'ethers';
const w = Wallet.createRandom();
console.log(JSON.stringify({ privateKey: w.privateKey, address: w.address }));
"@

$privateKey = ""
$evmAddress = ""
try {
    Push-Location (Join-Path $InstallDir "packages/node")
    $evmOutput = ($evmGenScript | node --input-type=module 2>$null)
    Pop-Location

    $evmObj = $evmOutput | ConvertFrom-Json
    $privateKey = $evmObj.privateKey
    $evmAddress = $evmObj.address
} catch {
    Pop-Location -ErrorAction SilentlyContinue
    Write-Warn "Could not generate EVM key (ethers not available yet). You can set CLAW_PRIVATE_KEY manually in .env."
}

# Determine chain RPC URL
switch ($Network) {
    "mainnet" { $chainRpcUrl = "https://rpc.clawnet.network" }
    "testnet" { $chainRpcUrl = "https://rpc.clawnetd.com" }
    default   { $chainRpcUrl = "http://127.0.0.1:8545" }
}

# Read contract addresses from prod contracts.json if available
$identityContract = ""
$contractsFile = Join-Path $InstallDir "infra\testnet\prod\contracts.json"
if (Test-Path $contractsFile) {
    try {
        $contracts = Get-Content $contractsFile -Raw | ConvertFrom-Json
        $identityContract = $contracts.ClawIdentity
        if (-not $identityContract) { $identityContract = $contracts.identity }
    } catch {}
}

Write-Info "Creating .env..."

$timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
$identityLine = if ($identityContract) { "CLAW_CHAIN_IDENTITY_CONTRACT=$identityContract" } else { "# CLAW_CHAIN_IDENTITY_CONTRACT=  # Set after contract deployment" }

$envContent = @"
# ============================================================================
# ClawNet Local Development Configuration
# Generated by setup.ps1 on $timestamp
# ============================================================================

# -- Network -------------------------------------------------------------------
CLAW_NETWORK=$Network

# -- Node Identity -------------------------------------------------------------
# Passphrase for encrypting the node identity key (REQUIRED)
CLAW_PASSPHRASE=$passphrase

# API key for authenticated REST endpoints
CLAW_API_KEY=$apiKey

# -- Chain Configuration -------------------------------------------------------
CLAW_CHAIN_RPC_URL=$chainRpcUrl
CLAW_CHAIN_ID=7625

# EVM signer private key (for on-chain transactions)
CLAW_PRIVATE_KEY=$privateKey

# -- Contract Addresses --------------------------------------------------------
$identityLine

# -- Storage -------------------------------------------------------------------
# CLAWNET_HOME=$DataDir

# -- API Server ----------------------------------------------------------------
# CLAW_API_HOST=127.0.0.1
# CLAW_API_PORT=9528

# -- P2P ----------------------------------------------------------------------
# CLAW_P2P_LISTEN=/ip4/0.0.0.0/tcp/9527
"@

Set-Content ".env" $envContent -NoNewline

Write-Ok ".env created"
Write-Host ""
Write-Host "  Passphrase:    $passphrase" -ForegroundColor White
Write-Host "  API Key:       $apiKey" -ForegroundColor White
if ($evmAddress) {
    Write-Host "  EVM Address:   $evmAddress" -ForegroundColor White
}
Write-Host ""
Write-Warn "Save these credentials! They are stored in .env - do not commit it to git."

# ── Step 5: Create data directory ─────────────────────────────────────

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
}
Write-Ok "Data directory: $DataDir"

# ── Step 6: Build workspace packages ─────────────────────────────────

Write-Info "Building workspace packages..."
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed" }
Write-Ok "Build complete"

# ── Step 7: Install Windows service (NSSM) ───────────────────────────

function Install-WindowsService {
    Write-Info "Setting up Windows service via NSSM..."

    $logDir = Join-Path $DataDir "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }

    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    $nodeDir  = Split-Path $nodePath

    # Check if NSSM is available
    $nssmPath = $null
    if (Get-Command nssm -ErrorAction SilentlyContinue) {
        $nssmPath = (Get-Command nssm).Source
    }
    $toolsNssm = Join-Path $InstallDir "tools\nssm.exe"
    if (-not $nssmPath -and (Test-Path $toolsNssm)) {
        $nssmPath = $toolsNssm
    }

    # Download NSSM if not found
    if (-not $nssmPath) {
        Write-Info "Downloading NSSM..."
        $nssmDir = Join-Path $InstallDir "tools"
        if (-not (Test-Path $nssmDir)) {
            New-Item -ItemType Directory -Force -Path $nssmDir | Out-Null
        }
        $nssmZip = Join-Path $nssmDir "nssm.zip"

        try {
            Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip -UseBasicParsing
        } catch {
            Write-Warn "Failed to download NSSM. Download manually from https://nssm.cc"
            return $false
        }

        Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force

        $nssmSubdir = if ([Environment]::Is64BitOperatingSystem) { "nssm-2.24\win64" } else { "nssm-2.24\win32" }
        Copy-Item (Join-Path $nssmDir $nssmSubdir "nssm.exe") (Join-Path $nssmDir "nssm.exe")
        Remove-Item (Join-Path $nssmDir "nssm-2.24") -Recurse -Force
        Remove-Item $nssmZip -Force

        $nssmPath = Join-Path $nssmDir "nssm.exe"
        Write-Ok "NSSM downloaded to $nssmPath"
    }

    # Remove existing service if present
    & $nssmPath stop ClawNet 2>$null | Out-Null
    & $nssmPath remove ClawNet confirm 2>$null | Out-Null

    # Build the daemon command
    $daemonJs = Join-Path $InstallDir "packages\node\dist\daemon.js"

    # Install the service
    & $nssmPath install ClawNet $nodePath "`"$daemonJs`" --data-dir `"$DataDir`" --network $Network"
    & $nssmPath set ClawNet AppDirectory $InstallDir
    & $nssmPath set ClawNet DisplayName "ClawNet Node"
    & $nssmPath set ClawNet Description "ClawNet Decentralized Agent Network Node"
    & $nssmPath set ClawNet Start SERVICE_AUTO_START
    & $nssmPath set ClawNet AppStdout (Join-Path $logDir "clawnetd-stdout.log")
    & $nssmPath set ClawNet AppStderr (Join-Path $logDir "clawnetd-stderr.log")
    & $nssmPath set ClawNet AppStdoutCreationDisposition 4
    & $nssmPath set ClawNet AppStderrCreationDisposition 4
    & $nssmPath set ClawNet AppRotateFiles 1
    & $nssmPath set ClawNet AppRotateBytes 10485760
    & $nssmPath set ClawNet AppExit Default Restart
    & $nssmPath set ClawNet AppRestartDelay 5000

    # Set environment variables for the service
    & $nssmPath set ClawNet AppEnvironmentExtra `
        "NODE_ENV=production" `
        "CLAW_PASSPHRASE=$passphrase" `
        "CLAW_API_KEY=$apiKey" `
        "CLAW_PRIVATE_KEY=$privateKey" `
        "CLAW_NETWORK=$Network" `
        "CLAW_CHAIN_RPC_URL=$chainRpcUrl"

    # Start the service
    & $nssmPath start ClawNet

    Write-Ok "Windows service 'ClawNet' installed and started"
    Write-Host ""
    Write-Host "  Manage the service:" -ForegroundColor White
    Write-Host "    nssm status ClawNet"
    Write-Host "    nssm stop ClawNet"
    Write-Host "    nssm start ClawNet"
    Write-Host "    nssm restart ClawNet"
    Write-Host "    nssm edit ClawNet                                   # GUI editor"
    Write-Host "    type $logDir\clawnetd-stderr.log                    # logs"
    return $true
}

Write-Host ""
$serviceInstalled = Install-WindowsService

if (-not $serviceInstalled) {
    Write-Warn "Service installation failed. Starting in foreground instead..."
    Write-Host ""
    Write-Host "  To start manually later:" -ForegroundColor White
    Write-Host "    cd $InstallDir"
    Write-Host "    node packages\node\dist\daemon.js --data-dir $DataDir --network $Network"
    Write-Host ""
    Set-Location $InstallDir
    node "packages\node\dist\daemon.js" --data-dir $DataDir --network $Network
    exit 0
}

# ── Step 8: Wait for node to be ready ─────────────────────────────────

Write-Info "Waiting for ClawNet node to start..."
$ready = $false
$healthUrl = "http://127.0.0.1:9528/api/v1/node"

for ($i = 1; $i -le 15; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
}

Write-Host ""
if ($ready) {
    Write-Host "ClawNet is running!" -ForegroundColor Green
    Write-Host ""

    try {
        $nodeInfo = (Invoke-WebRequest -Uri "http://127.0.0.1:9528/api/v1/identity" -UseBasicParsing -Headers @{"X-Api-Key"=$apiKey} -ErrorAction SilentlyContinue).Content | ConvertFrom-Json
        $did = $nodeInfo.data.did
        if (-not $did) { $did = $nodeInfo.did }
        if ($did) {
            Write-Host "  Your DID:  $did" -ForegroundColor White
        }
    } catch {}

    Write-Host ""
    Write-Host "  API:    http://127.0.0.1:9528"
    Write-Host "  P2P:    /ip4/0.0.0.0/tcp/9527"
    Write-Host ""
    Write-Host "  Verify: curl -s -H 'X-Api-Key: $apiKey' http://127.0.0.1:9528/api/v1/node"
} else {
    Write-Host "ClawNet installed but node may still be starting." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Check status:"
    Write-Host "    nssm status ClawNet"
    Write-Host "    type $DataDir\logs\clawnetd-stderr.log"
    Write-Host ""
    Write-Host "  Once running, the API is at http://127.0.0.1:9528"
}

Write-Host ""
Write-Host "  Credentials (save these!):" -ForegroundColor White
Write-Host "    Passphrase: $passphrase" -ForegroundColor Yellow
Write-Host "    API Key:    $apiKey" -ForegroundColor Yellow
if ($evmAddress) {
    Write-Host "    EVM Addr:   $evmAddress" -ForegroundColor Yellow
}
Write-Host ""
