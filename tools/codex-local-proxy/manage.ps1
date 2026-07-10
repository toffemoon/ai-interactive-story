param(
  [ValidateSet("start", "stop", "restart", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$ServerPath = Join-Path $ScriptDir "server.js"
$DataDir = Join-Path $Root "data\codex-local-proxy"
$PidPath = Join-Path $DataDir "proxy.pid"
$StdoutPath = Join-Path $DataDir "proxy.stdout.log"
$StderrPath = Join-Path $DataDir "proxy.stderr.log"
$EnvPath = Join-Path $Root ".env"

function Get-EnvValue([string]$Name) {
  if (-not (Test-Path -LiteralPath $EnvPath)) { return $null }
  $prefix = "$Name="
  foreach ($line in Get-Content -LiteralPath $EnvPath -Encoding UTF8) {
    if (-not $line.StartsWith($prefix, [StringComparison]::Ordinal)) { continue }
    $value = $line.Substring($prefix.Length).Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
  }
  return $null
}

$configuredPort = Get-EnvValue "CODEX_LOCAL_PROXY_PORT"
$Port = if ($configuredPort) { [int]$configuredPort } else { 8765 }
$HealthUrl = "http://127.0.0.1:$Port/health"
$ApiBaseUrl = "http://127.0.0.1:$Port/v1"

function Get-ProxyHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.model_alias -eq "codex") { return $health }
    return $null
  } catch {
    return $null
  }
}

function Get-ProxyPid {
  $health = Get-ProxyHealth
  if ($health -and $health.pid) { return [int]$health.pid }
  if (Test-Path -LiteralPath $PidPath) {
    $value = (Get-Content -LiteralPath $PidPath -Raw).Trim()
    if ($value -match '^\d+$') { return [int]$value }
  }
  return $null
}

function Test-ProxyProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  return $process -and $process.CommandLine -and $process.CommandLine.Contains("codex-local-proxy") -and $process.CommandLine.Contains("server.js")
}

function Show-Status {
  $health = Get-ProxyHealth
  if (-not $health) {
    Write-Output "Codex local proxy: stopped"
    Write-Output "API Base URL: $ApiBaseUrl"
    return
  }
  Write-Output "Codex local proxy: running (PID $($health.pid))"
  Write-Output "API Base URL: $($health.api_base_url)"
  Write-Output "Model: codex -> $($health.model)"
}

function Start-Proxy {
  if (Get-ProxyHealth) {
    Show-Status
    return
  }
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  $node = Get-Command node -ErrorAction Stop
  $process = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @("`"$ServerPath`"") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -LiteralPath $PidPath -Value $process.Id -Encoding Ascii

  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Seconds 1
    $health = Get-ProxyHealth
    if ($health) {
      Show-Status
      return
    }
    if ($process.HasExited) { break }
  }

  if (-not $process.HasExited -and (Test-ProxyProcess $process.Id)) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
  $detail = if (Test-Path -LiteralPath $StderrPath) {
    (Get-Content -LiteralPath $StderrPath -Tail 20 -Encoding UTF8) -join [Environment]::NewLine
  } else { "No error log was created." }
  throw "Codex local proxy failed to start.`n$detail"
}

function Stop-Proxy {
  $proxyProcessId = Get-ProxyPid
  if (-not $proxyProcessId) {
    Write-Output "Codex local proxy: already stopped"
    return
  }

  try {
    Invoke-RestMethod `
      -Uri "http://127.0.0.1:$Port/shutdown" `
      -Method Post `
      -Headers @{ "X-AI-Story-Proxy-PID" = [string]$proxyProcessId } `
      -TimeoutSec 3 | Out-Null
  } catch {}

  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Get-Process -Id $proxyProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if ((Get-Process -Id $proxyProcessId -ErrorAction SilentlyContinue) -and (Test-ProxyProcess $proxyProcessId)) {
    & taskkill.exe /PID $proxyProcessId /T /F | Out-Null
  }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
  Write-Output "Codex local proxy: stopped"
}

switch ($Action) {
  "start" { Start-Proxy }
  "stop" { Stop-Proxy }
  "restart" { Stop-Proxy; Start-Proxy }
  "status" { Show-Status }
}
