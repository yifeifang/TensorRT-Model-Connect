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
$build = Join-Path $WorkspaceRoot 'showcase/build-embedding'
& $cmake -S "$WorkspaceRoot/showcase/embedding-native" -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$($tc.NinjaExe)" '-DCMAKE_BUILD_TYPE=Release' "-DTRTMC_SOURCE_DIR=$source" "-DCMAKE_CUDA_COMPILER=$($tc.CudaRoot)/bin/nvcc.exe" "-DCUDAToolkit_ROOT=$($tc.CudaRoot)" "-DCMAKE_PREFIX_PATH=$($tc.JsonRoot)" "-DTRTMC_RTX_INCLUDE_DIR=$($tc.TensorRtRtxRoot)/include" "-DTRTMC_RTX_LIBRARY_DIR=$($tc.TensorRtRtxRoot)/lib"
if ($LASTEXITCODE) { throw 'embedding native configuration failed' }
& $cmake --build $build --parallel 8
if ($LASTEXITCODE) { throw 'embedding native build failed' }
$stage = Join-Path $build 'install'
& $cmake --install $build --prefix $stage
if ($LASTEXITCODE) { throw 'embedding native installation failed' }
$runtime = Join-Path $WorkspaceRoot 'runtime-embedding'
Copy-ShowcaseLocalRuntime -Toolchain $tc -Stage $stage -Destination $runtime
Write-Output "Local embedding runtime: $runtime"
