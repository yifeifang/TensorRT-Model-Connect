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
$build = Join-Path $WorkspaceRoot 'showcase/build-understanding-isolated'
& $cmake -S "$WorkspaceRoot/showcase/understanding-native" -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$($tc.NinjaExe)" '-DCMAKE_BUILD_TYPE=Release' "-DTRTMC_SOURCE_DIR=$source" "-DCMAKE_CUDA_COMPILER=$($tc.CudaRoot)/bin/nvcc.exe" "-DCUDAToolkit_ROOT=$($tc.CudaRoot)" "-DCMAKE_PREFIX_PATH=$($tc.JsonRoot)" "-DTRTMC_RTX_INCLUDE_DIR=$($tc.TensorRtRtxRoot)/include" "-DTRTMC_RTX_LIBRARY_DIR=$($tc.TensorRtRtxRoot)/lib"
if ($LASTEXITCODE) { throw 'understanding native configuration failed' }
& $cmake --build $build --parallel 8
if ($LASTEXITCODE) { throw 'understanding native build failed' }
$stage = Join-Path $build 'install'
& $cmake --install $build --prefix $stage
if ($LASTEXITCODE) { throw 'understanding native installation failed' }
$runtime = Join-Path $WorkspaceRoot 'runtime-understanding'
Copy-ShowcaseLocalRuntime -Toolchain $tc -Stage $stage -Destination $runtime
Write-Output "Local understanding runtime: $runtime"
Copy-Item -LiteralPath "$WorkspaceRoot/showcase/understanding-native/LICENSE-UNDERSTANDING-MODEL.txt" -Destination $runtime -Force
Copy-Item -LiteralPath "$WorkspaceRoot/showcase/understanding-native/UNDERSTANDING-MODEL-NOTICE.txt" -Destination $runtime -Force
