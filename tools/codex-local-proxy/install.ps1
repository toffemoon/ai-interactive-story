param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "AIStoryCodexBridge"),
  [int]$Port = 8765,
  [switch]$NoRegister,
  [switch]$SkipOAuth,
  [switch]$ForcePortableRuntime,
  [string]$SourceDir = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$BaseUrl = "https://ai-interactive-story.onrender.com/downloads/codex-bridge"
$AppUrl = "https://ai-interactive-story.onrender.com/#/mine?codex=connected"
$Origin = "https://ai-interactive-story.onrender.com"
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$DownloadsDir = Join-Path $InstallDir "downloads"

function Reset-ChildDirectory([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $root = $InstallDir.TrimEnd('\') + '\'
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset a directory outside the bridge install root: $full"
  }
  if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $full | Out-Null
}

function Get-Sha512Base64([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA512]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($stream)) }
    finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}

function Download-File([string]$Url, [string]$Path) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path | Out-Null
}

function Find-ExistingNode {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command node -ErrorAction SilentlyContinue }
  if (-not $command) { return $null }
  try {
    $version = (& $command.Source --version).Trim().TrimStart('v')
    if ([int]($version.Split('.')[0]) -ge 18) { return $command.Source }
  } catch {}
  return $null
}

function Install-PortableNode {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $fileTag = "win-$arch-zip"
  Write-Host "Installing portable Node.js..."
  $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
  $release = $index | Where-Object { $_.lts -and ($_.files -contains $fileTag) } | Select-Object -First 1
  if (-not $release) { throw "No compatible Node.js LTS release was found." }
  $zipName = "node-$($release.version)-win-$arch.zip"
  $releaseUrl = "https://nodejs.org/dist/$($release.version)"
  $zipPath = Join-Path $DownloadsDir $zipName
  if (-not (Test-Path -LiteralPath $zipPath)) { Download-File "$releaseUrl/$zipName" $zipPath }
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHASUMS256.txt").Content
  $line = ($sums -split "`n") | Where-Object { $_.Trim().EndsWith($zipName) } | Select-Object -First 1
  if (-not $line) { throw "Node.js checksum was not found." }
  $expected = ($line.Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Node.js checksum verification failed." }
  $runtimeRoot = Join-Path $InstallDir "runtime"
  Reset-ChildDirectory $runtimeRoot
  Expand-Archive -LiteralPath $zipPath -DestinationPath $runtimeRoot -Force
  $node = Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Filter node.exe | Select-Object -First 1
  if (-not $node) { throw "Portable Node.js did not contain node.exe." }
  return $node.FullName
}

function Find-ExistingCodex {
  $localBase = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
  if (Test-Path -LiteralPath $localBase) {
    $candidate = Get-ChildItem -LiteralPath $localBase -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "codex.exe" } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate }
  }
  foreach ($name in @("codex.exe", "codex")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command -and $command.Source -and $command.Source.EndsWith(".exe", [StringComparison]::OrdinalIgnoreCase)) {
      return $command.Source
    }
  }
  return $null
}

function Install-OfficialCodex {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $triple = if ($arch -eq "arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
  Write-Host "Installing the official OpenAI Codex CLI..."
  $latest = Invoke-RestMethod -Uri "https://registry.npmjs.org/@openai%2fcodex/latest"
  $packageVersion = "$($latest.version)-win32-$arch"
  $metadata = Invoke-RestMethod -Uri "https://registry.npmjs.org/@openai%2fcodex/$packageVersion"
  $archivePath = Join-Path $DownloadsDir "openai-codex-$packageVersion.tgz"
  if (-not (Test-Path -LiteralPath $archivePath)) { Download-File ([string]$metadata.dist.tarball) $archivePath }
  $expected = ([string]$metadata.dist.integrity).Replace("sha512-", "")
  if ((Get-Sha512Base64 $archivePath) -ne $expected) { throw "Codex package integrity verification failed." }
  $codexRoot = Join-Path $InstallDir "codex"
  Reset-ChildDirectory $codexRoot
  & tar.exe -xzf $archivePath -C $codexRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not extract the Codex package." }
  $codexPath = Join-Path $codexRoot "package\vendor\$triple\bin\codex.exe"
  if (-not (Test-Path -LiteralPath $codexPath)) { throw "Codex package did not contain codex.exe." }
  return $codexPath
}

function Install-BridgeFiles {
  $names = @("server.js", "launcher.ps1")
  if ($SourceDir) {
    foreach ($name in $names) {
      $source = Join-Path $SourceDir $name
      if (-not (Test-Path -LiteralPath $source)) { throw "Missing local source file: $source" }
      Copy-Item -LiteralPath $source -Destination (Join-Path $InstallDir $name) -Force
    }
    return
  }
  $manifest = Invoke-RestMethod -Uri "$BaseUrl/manifest.json"
  foreach ($name in $names) {
    $entry = $manifest.files.PSObject.Properties[$name].Value
    if (-not $entry -or -not $entry.sha256) { throw "Manifest entry is missing: $name" }
    $temporary = Join-Path $DownloadsDir "$name.download"
    Download-File "$BaseUrl/$name" $temporary
    $actual = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Bridge file verification failed: $name" }
    Move-Item -LiteralPath $temporary -Destination (Join-Path $InstallDir $name) -Force
  }
}

Write-Output "Setting up AI Story Codex Connector..."
New-Item -ItemType Directory -Force -Path $InstallDir, $DownloadsDir | Out-Null

$oldLauncher = Join-Path $InstallDir "launcher.ps1"
if (Test-Path -LiteralPath $oldLauncher) {
  try { & $oldLauncher stop | Out-Null } catch {}
}

$nodePath = if ($ForcePortableRuntime) { $null } else { Find-ExistingNode }
if (-not $nodePath) { $nodePath = Install-PortableNode }
$codexPath = if ($ForcePortableRuntime) { $null } else { Find-ExistingCodex }
if (-not $codexPath) { $codexPath = Install-OfficialCodex }

Install-BridgeFiles
$bridgeEnvPath = Join-Path $InstallDir "bridge.env"
if (-not (Test-Path -LiteralPath $bridgeEnvPath)) {
  Set-Content -LiteralPath $bridgeEnvPath -Value "" -Encoding Ascii
}
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "workspace") | Out-Null

$config = [ordered]@{
  node = $nodePath
  codex = $codexPath
  port = $Port
  origin = $Origin
  model = $null
  workspace = (Join-Path $InstallDir "workspace")
  appUrl = $AppUrl
}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallDir "config.json") -Encoding UTF8

if (-not $NoRegister) {
  $launcherPath = Join-Path $InstallDir "launcher.ps1"
  $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $startupDir "AI Story Codex Connector.lnk"))
  $shortcut.TargetPath = Join-Path $PSHOME "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`" start"
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.Save()

  $protocolKey = "HKCU:\Software\Classes\aistory-codex"
  New-Item -Path "$protocolKey\shell\open\command" -Force | Out-Null
  Set-Item -Path $protocolKey -Value "URL:AI Story Codex Connector"
  New-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  $protocolCommand = "`"$(Join-Path $PSHOME 'powershell.exe')`" -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" connect"
  Set-Item -Path "$protocolKey\shell\open\command" -Value $protocolCommand
}

$launcher = Join-Path $InstallDir "launcher.ps1"
if ($SkipOAuth) { & $launcher start }
else { & $launcher connect }
