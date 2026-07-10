@echo off
setlocal
set "INSTALLER_URL=https://ai-interactive-story.onrender.com/downloads/codex-bridge/install.ps1"
set "MANIFEST_URL=https://ai-interactive-story.onrender.com/downloads/codex-bridge/manifest.json"
set "INSTALLER_PATH=%TEMP%\AIStory-Codex-Install.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $manifest=Invoke-RestMethod -Uri $env:MANIFEST_URL; Invoke-WebRequest -UseBasicParsing -Uri $env:INSTALLER_URL -OutFile $env:INSTALLER_PATH; $expected=$manifest.files.PSObject.Properties['install.ps1'].Value.sha256; $actual=(Get-FileHash -LiteralPath $env:INSTALLER_PATH -Algorithm SHA256).Hash.ToLowerInvariant(); if($actual -ne ([string]$expected).ToLowerInvariant()){throw 'Installer verification failed.'}; & $env:INSTALLER_PATH"

if errorlevel 1 (
  echo.
  echo Setup did not finish. The error above can be used for support.
  pause
  exit /b 1
)

endlocal
