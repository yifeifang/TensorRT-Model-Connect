[CmdletBinding()]
param(
    [string]$WorkspaceRoot,
    [string]$ToolchainFile, [string]$DependencyRoot
)
$ErrorActionPreference = 'Stop'
if (-not $WorkspaceRoot) { $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path }
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Native -HostOnly
$cmake = $tc.CMakeExe
$ninja = $tc.NinjaExe
$build = Join-Path $WorkspaceRoot 'showcase\build-process-host'
$runtime = Join-Path $WorkspaceRoot 'runtime-host'
& $cmake -S "$WorkspaceRoot\showcase\process-host" -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$ninja" '-DCMAKE_BUILD_TYPE=Release'
if ($LASTEXITCODE) { throw 'Process host configuration failed' }
& $cmake --build $build --parallel 2
if ($LASTEXITCODE) { throw 'Process host build failed' }
& $cmake --install $build --prefix $runtime
if ($LASTEXITCODE) { throw 'Process host installation failed' }
Write-Output "Process guardian: $runtime\modelconnect_process_host.exe"
