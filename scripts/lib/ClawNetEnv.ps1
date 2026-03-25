function Get-ClawNetHome {
    if ($env:CLAWNET_HOME) {
        return $env:CLAWNET_HOME
    }

    return (Join-Path $HOME ".clawnet")
}

function Get-ClawNetEnvFile {
    return (Join-Path (Get-ClawNetHome) ".env")
}

function ConvertFrom-ClawNetEnvValue {
    param([string]$RawValue)

    $value = $RawValue.Trim()
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
        return $value.Substring(1, $value.Length - 2).
            Replace('\"', '"').
            Replace('\n', "`n").
            Replace('\r', "`r").
            Replace('\t', "`t").
            Replace('\\', '\')
    }

    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
        return $value.Substring(1, $value.Length - 2)
    }

    return $value
}

function Import-ClawNetEnv {
    $clawnetHome = Get-ClawNetHome
    $env:CLAWNET_HOME = $clawnetHome

    $envFile = Join-Path $clawnetHome ".env"
    $env:CLAWNET_ENV_FILE = $envFile

    if (-not (Test-Path $envFile)) {
        throw "Required ClawNet env file not found: $envFile`nProject-local .env files are no longer supported.`nMove your configuration to $envFile."
    }

    foreach ($line in Get-Content $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            continue
        }

        if ($trimmed.StartsWith('export ')) {
            $trimmed = $trimmed.Substring(7).Trim()
        }

        $eqIndex = $trimmed.IndexOf('=')
        if ($eqIndex -le 0) {
            continue
        }

        $key = $trimmed.Substring(0, $eqIndex).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            continue
        }

        if (Test-Path "Env:$key") {
            continue
        }

        $rawValue = $trimmed.Substring($eqIndex + 1)
        $value = ConvertFrom-ClawNetEnvValue $rawValue
        Set-Item -Path "Env:$key" -Value $value
    }
}
