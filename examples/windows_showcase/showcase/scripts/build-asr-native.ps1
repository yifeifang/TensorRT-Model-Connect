[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$DependencyRoot,
    [string]$ToolchainFile
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Native
$source = $tc.SourceRoot
$cmake = $tc.CMakeExe
$build = Join-Path $WorkspaceRoot 'showcase/build-asr-isolated'
& $cmake -S "$WorkspaceRoot/showcase/asr-native" -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$($tc.NinjaExe)" '-DCMAKE_BUILD_TYPE=Release' "-DTRTMC_SOURCE_DIR=$source" "-DCMAKE_CUDA_COMPILER=$($tc.CudaRoot)/bin/nvcc.exe" "-DCUDAToolkit_ROOT=$($tc.CudaRoot)" "-DCMAKE_PREFIX_PATH=$($tc.JsonRoot)" "-DTRTMC_RTX_INCLUDE_DIR=$($tc.TensorRtRtxRoot)/include" "-DTRTMC_RTX_LIBRARY_DIR=$($tc.TensorRtRtxRoot)/lib"
if ($LASTEXITCODE) { throw 'asr native configuration failed' }
& $cmake --build $build --parallel 8
if ($LASTEXITCODE) { throw 'asr native build failed' }
$stage = Join-Path $build 'install'
& $cmake --install $build --prefix $stage
if ($LASTEXITCODE) { throw 'asr native installation failed' }
$runtime = Join-Path $WorkspaceRoot 'runtime-asr'
Copy-ShowcaseLocalRuntime -Toolchain $tc -Stage $stage -Destination $runtime
Write-Output "Local asr runtime: $runtime"
