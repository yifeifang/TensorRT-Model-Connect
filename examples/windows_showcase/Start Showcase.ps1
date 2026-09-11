$ErrorActionPreference = 'Stop'
$demoExecutable = Join-Path $PSScriptRoot 'dist\ModelConnect Showcase\ModelConnect Showcase.exe'
if (!(Test-Path -LiteralPath $demoExecutable)) { & (Join-Path $PSScriptRoot 'showcase\scripts\package.ps1') }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $demoExecutable -WorkingDirectory $PSScriptRoot
