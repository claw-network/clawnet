# TelAgent one-click setup script for Windows (PowerShell)
# Usage: iwr -useb https://install.telagent.org/setup.ps1 | iex
#
# What it does:
#   1. Checks prerequisites (Node.js >=22, pnpm >=10, git)
#   2. Clones the TelAgent repo (or pulls if already cloned)
#   3. Installs dependencies via pnpm
#   4. Generates a private key and passphrase
#   5. Creates $TELAGENT_HOME/.env from template with generated values
#   6. Downloads mkcert and generates local TLS certificates
#   7. Builds workspace packages
#   8. Installs and starts TelAgent as a Windows service (NSSM)

$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────

function Write-Info  { param([string]$Msg) Write-Host "[info]  $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host "[error] $Msg" -ForegroundColor Red; exit 1 }

# ── Config ────────────────────────────────────────────────────────────

$RepoUrl    = "https://github.com/claw-network/clawnet.git"
$InstallDir = if ($env:TELAGENT_INSTALL_DIR) { $env:TELAGENT_INSTALL_DIR } else { Join-Path $env:USERPROFILE "telagent" }
$EnvDir     = if ($env:TELAGENT_HOME) { $env:TELAGENT_HOME } else { Join-Path $env:USERPROFILE ".telagent" }
$EnvFile    = Join-Path $EnvDir ".env"
$NodeMin    = 22
$NodeMax    = 24
$TelagentHome = if ($env:TELAGENT_HOME) { $env:TELAGENT_HOME } else { Join-Path $env:USERPROFILE ".telagent" }

$MkcertVersion   = "v1.4.4"
$MkcertBinDir    = Join-Path $TelagentHome "bin"
$MkcertCertDir   = Join-Path $TelagentHome "tls"
$MkcertDownloadBase = "https://install.telagent.org/binaries/mkcert"

Write-Host ""
Write-Host "  TelAgent Setup (Windows)" -ForegroundColor Cyan
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
if ($pnpmMajor -lt 10) {
    Write-Fail "pnpm $pnpmVersion is too old. Need >= 10. Run: corepack prepare pnpm@latest --activate"
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

Write-Host "[OK] Windows detected" -ForegroundColor Green

# ── Step 2: Clone or update repo ─────────────────────────────────────

if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Info "Existing repo found at $InstallDir, pulling latest..."
    git -C $InstallDir pull --ff-only
} else {
    Write-Info "Cloning ClawNet monorepo to $InstallDir..."
    git clone --depth 1 $RepoUrl $InstallDir
}
Write-Ok "Repo ready at $InstallDir"

Set-Location $InstallDir

# ── Step 3: Install dependencies ─────────────────────────────────────

Write-Info "Installing dependencies (this may take a minute)..."
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Write-Fail "pnpm install failed" }
Write-Ok "Dependencies installed"

# ── Step 4: Generate $TELAGENT_HOME/.env ──────────────────────────────

if (-not (Test-Path $EnvDir)) {
    New-Item -ItemType Directory -Force -Path $EnvDir | Out-Null
}

if (Test-Path $EnvFile) {
    $backup = Join-Path $EnvDir ".env.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
    Write-Warn "$EnvFile already exists, backing up to $backup"
    Copy-Item $EnvFile $backup
}

# Generate random passphrase (32 hex chars)
$passphrase = (node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

# Generate random keyfile password
$keyfilePassword = (node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

# Generate keyfile (encrypted JSON keystore)
$keyfileDir = Join-Path $TelagentHome "secrets"
$keyfilePath = Join-Path $keyfileDir "signer-key.json"
if (-not (Test-Path $keyfileDir)) {
    New-Item -ItemType Directory -Force -Path $keyfileDir | Out-Null
}

Write-Info "Generating encrypted keyfile..."

$keyGenScript = @"
import { Wallet } from 'ethers';
import { writeFileSync } from 'node:fs';
const w = Wallet.createRandom();
const json = await w.encrypt('$keyfilePassword');
writeFileSync('$($keyfilePath -replace '\\', '/')', json);
console.log(JSON.stringify({ address: w.address }));
"@

Push-Location (Join-Path $InstallDir "packages/client")
$keyOutput = ($keyGenScript | node --input-type=module)
Pop-Location

# Parse address from JSON output
try {
    $addressObj = $keyOutput | ConvertFrom-Json
    $address = $addressObj.address
} catch {
    # Fallback: regex extract
    if ($keyOutput -match '"address"\s*:\s*"([^"]+)"') {
        $address = $Matches[1]
    } else {
        $address = "(unknown)"
    }
}

Write-Info "Creating $EnvFile..."
Copy-Item "apps/telagent/.env.example" $EnvFile

# Patch $TELAGENT_HOME/.env values
$envContent = Get-Content $EnvFile -Raw
$envContent = $envContent -replace 'TELAGENT_SIGNER_TYPE=env', 'TELAGENT_SIGNER_TYPE=keyfile'
$envContent = $envContent -replace 'TELAGENT_SIGNER_ENV=TELAGENT_PRIVATE_KEY', '# TELAGENT_SIGNER_ENV=TELAGENT_PRIVATE_KEY'
$envContent = $envContent -replace 'TELAGENT_PRIVATE_KEY=0xYOUR_PRIVATE_KEY', '# TELAGENT_PRIVATE_KEY='
$envContent = $envContent -replace '# TELAGENT_SIGNER_PATH=/absolute/path/to/signer\.key', "TELAGENT_SIGNER_PATH=$keyfilePath"
$envContent = $envContent -replace 'TELAGENT_CLAWNET_PASSPHRASE=replace_with_secure_passphrase', "TELAGENT_CLAWNET_PASSPHRASE=$passphrase"
$envContent = $envContent -replace 'TELAGENT_GROUP_REGISTRY_CONTRACT=0x0000000000000000000000000000000000000000', 'TELAGENT_GROUP_REGISTRY_CONTRACT=0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e'
$envContent += "`n# Keyfile decryption password (auto-generated by setup.ps1)`n"
$envContent += "TELAGENT_SIGNER_PASSWORD=$keyfilePassword`n"
Set-Content $EnvFile $envContent -NoNewline

Write-Ok "$EnvFile created"
Write-Host ""
Write-Host "  Wallet address:  $address" -ForegroundColor White
Write-Host "  Keyfile:         $keyfilePath" -ForegroundColor White
Write-Host "  Passphrase:      $passphrase" -ForegroundColor White
Write-Host "  Env file:        $EnvFile" -ForegroundColor White
Write-Host ""
Write-Warn "Save these values! The keyfile is encrypted at $keyfilePath."
Write-Warn "The keyfile password and passphrase are in $EnvFile."

# ── Step 4b: Generate local TLS certificates (mkcert) ────────────────

function Install-Mkcert {
    # Check if mkcert is already in PATH
    if (Get-Command mkcert -ErrorAction SilentlyContinue) {
        $script:mkcertBin = (Get-Command mkcert).Source
        Write-Ok "mkcert found at $($script:mkcertBin)"
        return $true
    }

    # Check if we already downloaded it
    $mkcertExe = Join-Path $MkcertBinDir "mkcert.exe"
    if (Test-Path $mkcertExe) {
        $script:mkcertBin = $mkcertExe
        Write-Ok "mkcert found at $mkcertExe"
        return $true
    }

    Write-Info "mkcert not found, downloading..."

    # Detect architecture
    $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "amd64" }
    $filename = "mkcert-$MkcertVersion-windows-$arch.exe"
    $url = "$MkcertDownloadBase/$filename"

    if (-not (Test-Path $MkcertBinDir)) {
        New-Item -ItemType Directory -Force -Path $MkcertBinDir | Out-Null
    }

    try {
        Invoke-WebRequest -Uri $url -OutFile $mkcertExe -UseBasicParsing
    } catch {
        Write-Warn "Failed to download mkcert from $url"
        return $false
    }

    $script:mkcertBin = $mkcertExe
    Write-Ok "mkcert downloaded to $mkcertExe"
    return $true
}

function Install-LocalCerts {
    if ($env:MKCERT_SKIP -eq "1") {
        Write-Info "MKCERT_SKIP=1, skipping certificate generation"
        return $false
    }

    Write-Info "Setting up local HTTPS certificates..."

    if (-not (Install-Mkcert)) {
        Write-Warn "Could not obtain mkcert - skipping certificate generation"
        Write-Warn "TLS will not be available. The node will serve plain HTTP."
        return $false
    }

    # Install CA into system trust store
    Write-Info "Installing local CA into system trust store..."
    Write-Info "(You may see a Windows security prompt - click Yes to trust the CA)"
    try {
        & $script:mkcertBin -install 2>&1 | Out-Null
        Write-Ok "Local CA installed"
    } catch {
        Write-Warn "mkcert -install failed (security prompt may have been declined)"
        Write-Warn "Certificates will be generated but may not be trusted by the system"
    }

    # Generate certificates
    $certFile = Join-Path $MkcertCertDir "cert.pem"
    $keyFile  = Join-Path $MkcertCertDir "key.pem"

    if ((Test-Path $certFile) -and (Test-Path $keyFile)) {
        Write-Ok "Certificates already exist at $MkcertCertDir"
    } else {
        Write-Info "Generating certificates for localhost..."
        if (-not (Test-Path $MkcertCertDir)) {
            New-Item -ItemType Directory -Force -Path $MkcertCertDir | Out-Null
        }

        & $script:mkcertBin -cert-file $certFile -key-file $keyFile localhost 127.0.0.1 "::1"
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Certificate generation failed"
            return $false
        }
        Write-Ok "Certificate: $certFile"
        Write-Ok "Key:         $keyFile"
    }

    # Enable TLS in $TELAGENT_HOME/.env
    $envContent = Get-Content $EnvFile -Raw
    $envContent = $envContent -replace '# TELAGENT_TLS_CERT=/path/to/cert\.pem', "TELAGENT_TLS_CERT=$certFile"
    $envContent = $envContent -replace '# TELAGENT_TLS_KEY=/path/to/key\.pem', "TELAGENT_TLS_KEY=$keyFile"
    $envContent = $envContent -replace '# TELAGENT_TLS_PORT=9443', 'TELAGENT_TLS_PORT=9443'

    # Set NODE_EXTRA_CA_CERTS
    $caRoot = (& $script:mkcertBin -CAROOT 2>$null)
    if ($caRoot -and (Test-Path (Join-Path $caRoot "rootCA.pem"))) {
        $caRootPem = Join-Path $caRoot "rootCA.pem"
        $envContent += "`n# mkcert root CA (so Node.js trusts locally-issued certs)`n"
        $envContent += "NODE_EXTRA_CA_CERTS=$caRootPem`n"
    }
    Set-Content $EnvFile $envContent -NoNewline

    Write-Ok "TLS enabled: https://127.0.0.1:9443"
    return $true
}

$tlsEnabled = Install-LocalCerts

# ── Step 5: Build workspace packages ─────────────────────────────────

Write-Info "Building workspace packages..."
pnpm --filter @claw-network/client build
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to build @claw-network/client" }
Write-Ok "Node package built"

# ── Step 6: Install Windows service (NSSM) ───────────────────────────

function Install-WindowsService {
    Write-Info "Setting up Windows service via NSSM..."

    $logDir = Join-Path $TelagentHome "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }

    $pnpmPath = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    $nodeDir  = Split-Path $nodePath

    # Find pnpm.cmd (preferred on Windows)
    $pnpmCmd = Join-Path $nodeDir "pnpm.cmd"
    if (-not (Test-Path $pnpmCmd)) {
        $pnpmCmd = $pnpmPath
    }

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
            Write-Warn "Starting TelAgent in foreground instead..."
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
    & $nssmPath stop TelAgent 2>$null | Out-Null
    & $nssmPath remove TelAgent confirm 2>$null | Out-Null

    # Install the service
    & $nssmPath install TelAgent $pnpmCmd "telagent:dev"
    & $nssmPath set TelAgent AppDirectory $InstallDir
    & $nssmPath set TelAgent DisplayName "TelAgent Node"
    & $nssmPath set TelAgent Description "TelAgent decentralized messaging node"
    & $nssmPath set TelAgent Start SERVICE_AUTO_START
    & $nssmPath set TelAgent AppStdout (Join-Path $logDir "telagent-stdout.log")
    & $nssmPath set TelAgent AppStderr (Join-Path $logDir "telagent-stderr.log")
    & $nssmPath set TelAgent AppStdoutCreationDisposition 4
    & $nssmPath set TelAgent AppStderrCreationDisposition 4
    & $nssmPath set TelAgent AppRotateFiles 1
    & $nssmPath set TelAgent AppRotateBytes 10485760
    & $nssmPath set TelAgent AppExit Default Restart
    & $nssmPath set TelAgent AppRestartDelay 3000

    # Start the service
    & $nssmPath start TelAgent

    Write-Ok "Windows service 'TelAgent' installed and started"
    Write-Host ""
    Write-Host "  Manage the service:" -ForegroundColor White
    Write-Host "    nssm status TelAgent"
    Write-Host "    nssm stop TelAgent"
    Write-Host "    nssm start TelAgent"
    Write-Host "    nssm restart TelAgent"
    Write-Host "    nssm edit TelAgent                                  # GUI editor"
    Write-Host "    type $logDir\telagent-stderr.log                    # logs"
    return $true
}

Write-Host ""
$serviceInstalled = Install-WindowsService

if (-not $serviceInstalled) {
    Write-Warn "Service installation failed. Starting in foreground instead..."
    Write-Host ""
    Write-Host "  To start manually later:" -ForegroundColor White
    Write-Host "    cd $InstallDir; pnpm telagent:dev"
    Write-Host ""
    Set-Location $InstallDir
    pnpm telagent:dev
    exit 0
}

# ── Step 7: Wait for node to be ready ─────────────────────────────────

Write-Info "Waiting for TelAgent node to start..."
$ready = $false

if ($tlsEnabled) {
    $healthUrl = "https://127.0.0.1:9443/api/v1/node/"
    $apiUrl    = "https://127.0.0.1:9443"
    $webappUrl = "https://localhost:5173"
} else {
    $healthUrl = "http://127.0.0.1:9529/api/v1/node/"
    $apiUrl    = "http://127.0.0.1:9529"
    $webappUrl = "http://localhost:5173"
}

for ($i = 1; $i -le 15; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3 -SkipCertificateCheck -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # Node not ready yet
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
if ($ready) {
    Write-Host "TelAgent is running!" -ForegroundColor Green
    Write-Host ""

    try {
        $nodeInfo = (Invoke-WebRequest -Uri "$apiUrl/api/v1/identities/self" -UseBasicParsing -SkipCertificateCheck -ErrorAction SilentlyContinue).Content | ConvertFrom-Json
        $did = $nodeInfo.data.did
        if ($did) {
            Write-Host "  Your DID:  $did" -ForegroundColor White
        }
    } catch {}

    Write-Host ""
    Write-Host "  Node API:  $apiUrl"
    Write-Host ""
    Write-Host "  Start the WebApp (optional):"
    Write-Host "    cd $InstallDir; pnpm telagent:web:dev"
    Write-Host "    Then open $webappUrl and enter your passphrase to connect."
} else {
    Write-Host "TelAgent installed but node may still be starting." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Check status:"
    Write-Host "    nssm status TelAgent"
    Write-Host "    type $TelagentHome\logs\telagent-stderr.log"
    Write-Host ""
    Write-Host "  Once running, the API is at $apiUrl"
}
Write-Host ""
