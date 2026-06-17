$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$localUrl = 'http://localhost:8787'

function Invoke-Npm {
  param([Parameter(Mandatory = $true)][string[]]$NpmArgs)
  & npm @NpmArgs
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($NpmArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Test-LocalServer {
  try {
    $response = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Get-PhoneIp {
  $addresses = @()
  try {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
        $_.PrefixOrigin -ne 'WellKnown'
      } |
      Sort-Object InterfaceMetric |
      Select-Object -ExpandProperty IPAddress
  } catch {
    $addresses = [System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) |
      Where-Object {
        $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
        $_.IPAddressToString -notmatch '^(127\.|169\.254\.)'
      } |
      ForEach-Object { $_.IPAddressToString }
  }
  return $addresses | Select-Object -First 1
}

Write-Host ''
Write-Host 'SoCal Event Radar local launcher' -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
  Write-Host ''
  Write-Host 'node_modules missing; running npm install...' -ForegroundColor Yellow
  Invoke-Npm @('install')
} else {
  Write-Host 'node_modules found; skipping npm install.'
}

Write-Host ''
Write-Host 'Collecting latest events...'
Invoke-Npm @('run', 'collect')

Write-Host ''
Write-Host 'Validating app data...'
Invoke-Npm @('run', 'validate')

$alreadyRunning = Test-LocalServer
if ($alreadyRunning) {
  Write-Host ''
  Write-Host "$localUrl is already running." -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'Starting dev server in a separate PowerShell window...' -ForegroundColor Green
  $devCommand = "Set-Location -LiteralPath '$($repoRoot.Path.Replace("'", "''"))'; npm run dev"
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $devCommand

  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-LocalServer) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    throw "Dev server did not respond at $localUrl"
  }
}

$phoneIp = Get-PhoneIp
$phoneUrl = if ($phoneIp) { "http://${phoneIp}:8787" } else { 'No LAN IPv4 address found' }

Write-Host ''
Write-Host "Local URL: $localUrl" -ForegroundColor Cyan
Write-Host "Phone URL: $phoneUrl" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Opening radar in the default browser...'
Start-Process $localUrl

Write-Host ''
Write-Host 'Tip: open /phone.html for iPhone setup notes.'
