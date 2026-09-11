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
$build = Join-Path $WorkspaceRoot 'showcase/build-voice-isolated'
& $tc.CMakeExe -S "$WorkspaceRoot/showcase/voice-native" -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$($tc.NinjaExe)" '-DCMAKE_BUILD_TYPE=Release' "-DTRTMC_SOURCE_DIR=$source" "-DCMAKE_CUDA_COMPILER=$($tc.CudaRoot)/bin/nvcc.exe" "-DCUDAToolkit_ROOT=$($tc.CudaRoot)" "-DCMAKE_PREFIX_PATH=$($tc.JsonRoot)" "-DTRTMC_RTX_INCLUDE_DIR=$($tc.TensorRtRtxRoot)/include" "-DTRTMC_RTX_LIBRARY_DIR=$($tc.TensorRtRtxRoot)/lib"
if ($LASTEXITCODE) { throw 'Voice native configuration failed' }
& $tc.CMakeExe --build $build --parallel 8
if ($LASTEXITCODE) { throw 'Voice native build failed' }
$stage = Join-Path $build 'install'
& $tc.CMakeExe --install $build --prefix $stage
if ($LASTEXITCODE) { throw 'Voice native installation failed' }
Copy-ShowcaseLocalRuntime -Toolchain $tc -Stage $stage -Destination (Join-Path $WorkspaceRoot 'runtime-voice')
