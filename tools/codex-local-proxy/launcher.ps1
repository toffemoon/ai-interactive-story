param(
  [ValidateSet("start", "stop", "status", "connect")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$InstallDir = $PSScriptRoot
$ConfigPath = Join-Path $InstallDir "config.json"
$ServerPath = Join-Path $InstallDir "server.js"
$DataDir = Join-Path $InstallDir "data"
$PidPath = Join-Path $DataDir "bridge.pid"
$StdoutPath = Join-Path $DataDir "bridge.stdout.log"
$StderrPath = Join-Path $DataDir "bridge.stderr.log"

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Bridge config is missing. Run setup again." }
if (-not (Test-Path -LiteralPath $ServerPath)) { throw "Bridge server is missing. Run setup again." }

$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Port = [int]$Config.port
$HealthUrl = "http://127.0.0.1:$Port/health"
$AuthBaseUrl = "http://127.0.0.1:$Port/auth"

function Get-BridgeHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.model_alias -eq "codex") { return $health }
  } catch {}
  return $null
}

function Get-BridgePid {
  $health = Get-BridgeHealth
  if ($health -and $health.pid) { return [int]$health.pid }
  if (Test-Path -LiteralPath $PidPath) {
    $value = (Get-Content -LiteralPath $PidPath -Raw).Trim()
    if ($value -match '^\d+$') { return [int]$value }
  }
  return $null
}

function Test-BridgeProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  return $process -and $process.CommandLine -and $process.CommandLine.Contains($ServerPath)
}

function Start-Bridge {
  $health = Get-BridgeHealth
  if ($health) { return $health }

  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $env:CODEX_LOCAL_PROXY_PORT = [string]$Port
  $env:CODEX_LOCAL_PROXY_ALLOWED_ORIGINS = [string]$Config.origin
  $env:CODEX_LOCAL_PROXY_CODEX_BIN = [string]$Config.codex
  $env:CODEX_LOCAL_PROXY_WORKSPACE = [string]$Config.workspace
  $env:CODEX_LOCAL_PROXY_ENV_FILE = Join-Path $InstallDir "bridge.env"
  if ($Config.model) { $env:CODEX_LOCAL_PROXY_MODEL = [string]$Config.model }
  else { Remove-Item Env:\CODEX_LOCAL_PROXY_MODEL -ErrorAction SilentlyContinue }

  $process = Start-Process `
    -FilePath ([string]$Config.node) `
    -ArgumentList @("`"$ServerPath`"") `
    -WorkingDirectory $InstallDir `
    -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -LiteralPath $PidPath -Value $process.Id -Encoding Ascii

  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Seconds 1
    $health = Get-BridgeHealth
    if ($health) { return $health }
    if ($process.HasExited) { break }
  }
  if (-not $process.HasExited -and (Test-BridgeProcess $process.Id)) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
  $detail = if (Test-Path -LiteralPath $StderrPath) {
    (Get-Content -LiteralPath $StderrPath -Tail 20 -Encoding UTF8) -join [Environment]::NewLine
  } else { "No error log was created." }
  throw "Codex bridge failed to start.`n$detail"
}

function Stop-Bridge {
  $bridgeProcessId = Get-BridgePid
  if (-not $bridgeProcessId) { return }
  try {
    Invoke-RestMethod `
      -Uri "http://127.0.0.1:$Port/shutdown" `
      -Method Post `
      -Headers @{ "X-AI-Story-Proxy-PID" = [string]$bridgeProcessId } `
      -TimeoutSec 3 | Out-Null
  } catch {}
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Get-Process -Id $bridgeProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if ((Get-Process -Id $bridgeProcessId -ErrorAction SilentlyContinue) -and (Test-BridgeProcess $bridgeProcessId)) {
    & taskkill.exe /PID $bridgeProcessId /T /F | Out-Null
  }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Get-AuthStatus {
  try { return Invoke-RestMethod -Uri "$AuthBaseUrl/status" -Method Get -TimeoutSec 10 }
  catch { return $null }
}

function Wait-ForLogin([string]$LoginId, [int]$Seconds) {
  for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
    Start-Sleep -Seconds 1
    try {
      $status = Invoke-RestMethod `
        -Uri "$AuthBaseUrl/login/status?login_id=$([Uri]::EscapeDataString($LoginId))" `
        -Method Get `
        -TimeoutSec 10
      if ($status.account -and $status.account.authenticated) { return $true }
      if ($status.status -eq "failed" -or $status.status -eq "cancelled") { return $false }
    } catch {}
  }
  return $false
}

function Start-LoginFlow([string]$Flow) {
  $body = @{ flow = $Flow } | ConvertTo-Json -Compress
  return Invoke-RestMethod `
    -Uri "$AuthBaseUrl/login/start" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body `
    -TimeoutSec 30
}

function Connect-Codex {
  $health = Start-Bridge
  Write-Output "AI Story Codex bridge is running on port $Port."
  $account = Get-AuthStatus
  if ($account -and $account.authenticated) {
    Write-Output "Codex is already connected."
    Start-Process ([string]$Config.appUrl)
    return
  }

  Write-Output "Opening ChatGPT sign-in..."
  $login = Start-LoginFlow "browser"
  if ($login.status -eq "authenticated" -or ($login.account -and $login.account.authenticated)) {
    Start-Process ([string]$Config.appUrl)
    return
  }
  if (-not $login.auth_url) { throw "Codex did not return an OAuth URL." }
  Start-Process ([string]$login.auth_url)
  if (Wait-ForLogin ([string]$login.login_id) 180) {
    Write-Output "Codex connected successfully."
    Start-Process ([string]$Config.appUrl)
    return
  }

  try {
    $cancelBody = @{ login_id = [string]$login.login_id } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$AuthBaseUrl/login/cancel" -Method Post -ContentType "application/json" -Body $cancelBody -TimeoutSec 10 | Out-Null
  } catch {}

  Write-Output "Browser callback did not finish. Switching to device code."
  $device = Start-LoginFlow "device"
  if (-not $device.verification_url -or -not $device.user_code) {
    throw "Codex device login is unavailable for this account."
  }
  try { Set-Clipboard -Value ([string]$device.user_code) } catch {}
  Write-Output "Device code: $($device.user_code) (copied to clipboard)"
  Start-Process ([string]$device.verification_url)
  if (-not (Wait-ForLogin ([string]$device.login_id) 300)) {
    throw "Codex sign-in timed out. Run the connector again to retry."
  }
  Write-Output "Codex connected successfully."
  Start-Process ([string]$Config.appUrl)
}

switch ($Action) {
  "start" {
    $health = Start-Bridge
    Write-Output "running http://127.0.0.1:$Port/v1 model=$($health.model)"
  }
  "stop" {
    Stop-Bridge
    Write-Output "stopped"
  }
  "status" {
    $health = Get-BridgeHealth
    if ($health) { Write-Output "running http://127.0.0.1:$Port/v1 model=$($health.model)" }
    else { Write-Output "stopped" }
  }
  "connect" { Connect-Codex }
}
