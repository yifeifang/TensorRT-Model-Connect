# Shared build mechanics. Model settings remain in each capability's build script.
function Get-ShowcaseToolchain {
    param([string]$WorkspaceRoot, [string]$DependencyRoot, [string]$ToolchainFile,
          [switch]$Native, [switch]$Python, [switch]$HostOnly)
    $workspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
    if (-not $ToolchainFile) { $ToolchainFile = $env:MODELCONNECT_SHOWCASE_TOOLCHAIN }
    if (-not $DependencyRoot) { $DependencyRoot = $env:MODELCONNECT_SHOWCASE_DEPENDENCIES }
    $settings = @{}
    if ($ToolchainFile) {
        $configPath = (Resolve-Path -LiteralPath $ToolchainFile).Path
        $configRoot = Split-Path $configPath
        $document = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        foreach ($property in $document.PSObject.Properties) {
            $value = [Environment]::ExpandEnvironmentVariables([string]$property.Value)
            if ($value -and -not [IO.Path]::IsPathRooted($value)) { $value = Join-Path $configRoot $value }
            $settings[$property.Name] = $value
        }
    }
    $defaults = @{ SourceRoot = (Join-Path $workspace 'vendor/ModelConnect') }
    # Optional compatibility layout; users can instead provide independent paths.
    if ($DependencyRoot) {
        $defaults.PythonExe = Join-Path $DependencyRoot 'python/Scripts/python.exe'
        $defaults.CMakeExe = Join-Path $DependencyRoot 'python/Scripts/cmake.exe'
        $defaults.NinjaExe = Join-Path $DependencyRoot 'python/Scripts/ninja.exe'
        $defaults.CudaRoot = Join-Path $DependencyRoot 'cuda-13.4'
        $defaults.TensorRtRtxRoot = Join-Path $DependencyRoot 'tensorrt-rtx/TensorRT-RTX-1.6.1.120'
        $defaults.JsonRoot = Join-Path $DependencyRoot 'nlohmann-json/install'
        $defaults.MsvcRoot = Join-Path $DependencyRoot 'VSBuildTools/VC/Tools/MSVC/14.44.35207'
        $defaults.WindowsSdkRoot = Join-Path $DependencyRoot 'windows-sdk-portable/c'
        $defaults.WindowsSdkLibRoot = Join-Path $DependencyRoot 'windows-sdk-x64-portable/c'
        $crt = Join-Path $DependencyRoot 'VSBuildTools/VC/Redist/MSVC'
        if (Test-Path -LiteralPath $crt) {
            $version = Get-ChildItem -LiteralPath $crt -Directory | Where-Object Name -Match '^\d' | Sort-Object Name -Descending | Select-Object -First 1
            if ($version) { $defaults.CrtRoot = Join-Path $version.FullName 'x64/Microsoft.VC143.CRT' }
        }
    }
    foreach ($name in $defaults.Keys) { if (-not $settings[$name]) { $settings[$name] = $defaults[$name] } }
    foreach ($pair in @(@('PythonExe','python.exe'), @('CMakeExe','cmake.exe'), @('NinjaExe','ninja.exe'))) {
        if (-not $settings[$pair[0]]) { $command = Get-Command $pair[1] -ErrorAction SilentlyContinue; if ($command) { $settings[$pair[0]] = $command.Source } }
    }
    if (-not $settings.CudaRoot) { $settings.CudaRoot = $env:CUDA_PATH }
    $required = @()
    if ($Python) { $required += 'PythonExe' }
    if ($Native) {
        $required += 'CMakeExe','NinjaExe'
        if (-not $HostOnly) { $required += 'SourceRoot','CudaRoot','TensorRtRtxRoot','JsonRoot' }
    }
    foreach ($name in $required) {
        if (-not $settings[$name] -or -not (Test-Path -LiteralPath $settings[$name])) { throw "Missing $name. Configure it in -ToolchainFile; see showcase/BUILD_FROM_SOURCE.md." }
    }
    if ($Native) {
        if ($settings.MsvcRoot) {
            $compiler = $settings.MsvcRoot
            $sdk = $settings.WindowsSdkRoot
            $sdkLib = $settings.WindowsSdkLibRoot
            if (-not $sdkLib) { $sdkLib = Join-Path $sdk 'Lib' }
            $includeVersions = @(Get-ChildItem -LiteralPath (Join-Path $sdk 'Include') -Directory | Sort-Object Name -Descending)
            if (-not $includeVersions.Count) { throw 'No Windows SDK include version found.' }
            $sdkVersion = $includeVersions[0].Name
            $sdkInclude = $includeVersions[0].FullName
            if (Test-Path -LiteralPath (Join-Path $sdkLib $sdkVersion)) { $sdkLib = Join-Path $sdkLib $sdkVersion }
            $env:INCLUDE = "$compiler\include;$sdkInclude\ucrt;$sdkInclude\shared;$sdkInclude\um;$sdkInclude\winrt;$sdkInclude\cppwinrt"
            $env:LIB = "$compiler\lib\x64;$sdkLib\ucrt\x64;$sdkLib\um\x64"
            $env:PATH = "$compiler\bin\Hostx64\x64;$sdk\bin\$sdkVersion\x64;" + $env:PATH
            $env:VSCMD_ARG_TGT_ARCH = 'x64'
        }
        if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) { throw 'Run from an x64 Visual Studio Developer PowerShell, or configure MsvcRoot and WindowsSdkRoot.' }
        if (-not $HostOnly) {
            if (-not (Test-Path -LiteralPath (Join-Path $settings.CudaRoot 'bin/nvcc.exe'))) { throw 'CudaRoot must contain bin/nvcc.exe.' }
            if (-not (Test-Path -LiteralPath (Join-Path $settings.TensorRtRtxRoot 'include/NvInfer.h'))) { throw 'TensorRtRtxRoot must contain include/NvInfer.h.' }
            $env:CUDA_PATH = $settings.CudaRoot
            $env:PATH = "$($settings.CudaRoot)\bin;$($settings.CudaRoot)\bin\x64;$($settings.TensorRtRtxRoot)\bin;" + $env:PATH
        }
    }
    return $settings
}

function Copy-ShowcaseLocalRuntime {
    param([hashtable]$Toolchain, [string]$Stage, [string]$Destination)
    # This is a user's local runtime, never an artifact eligible for source distribution.
    $null = New-Item -ItemType Directory -Force -Path $Destination
    Get-ChildItem -LiteralPath (Join-Path $Stage 'bin') -File | Copy-Item -Destination $Destination -Force
    foreach ($directory in @((Join-Path $Toolchain.CudaRoot 'bin'), (Join-Path $Toolchain.TensorRtRtxRoot 'bin'))) {
        Get-ChildItem -LiteralPath $directory -Filter '*.dll' -File -Recurse | Copy-Item -Destination $Destination -Force
    }
    if ($Toolchain.CrtRoot) { Get-ChildItem -LiteralPath $Toolchain.CrtRoot -Filter '*.dll' -File | Copy-Item -Destination $Destination -Force }
    'User-created local runtime. Do not publish without a separate redistribution review of every included binary.' | Set-Content -LiteralPath (Join-Path $Destination 'LOCAL-ONLY.txt')
}
