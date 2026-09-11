[CmdletBinding()]
param(
    [ValidateSet('Check','Source','Python','Download','Native','Models','Shell')]
    [string]$Action = 'Check',
    [ValidateSet('text','asr','embedding','vision','understanding','geometry','voice')]
    [string[]]$Capabilities = @('text','asr','embedding','vision','understanding','geometry'),
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ToolchainFile,
    [string]$DependencyRoot,
    [switch]$Plan,
    [switch]$AcknowledgeModelTerms,
    [switch]$AcknowledgeDependencyTerms
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$Capabilities = @($Capabilities | Select-Object -Unique)
$inventory = Get-Content -LiteralPath "$WorkspaceRoot/showcase/distribution/model-licenses.json" -Raw | ConvertFrom-Json
$selectedIds = @($Capabilities)
if ($Capabilities -contains 'voice') { $selectedIds += 'voice-tokenizer' }
$selectedModels = @($inventory.models | Where-Object { $_.id -in $selectedIds })
if ($Action -eq 'Download' -or $Plan) {
    foreach ($model in $selectedModels) {
        Write-Output "$($model.id): $($model.repository)@$($model.revision) [$($model.license)]"
        Write-Output "Terms: $($model.licenseUrl)"
        foreach ($condition in $model.conditions) { Write-Output "  $condition" }
    }
}
if ($Plan) {
    Write-Output "Plan only: action=$Action; capabilities=$($Capabilities -join ','). No downloads, installs, patches, builds, or environment changes were made."
    Write-Output 'Source: pinned SDK checkout inside vendor; Python: local .venv and selected overlays; Download: selected pinned weights; Native: process guardian and selected bridges; Models: selected GPU bundles; Shell: desktop shell only.'
    return
}
if ($Action -eq 'Download' -and -not $AcknowledgeModelTerms) { throw 'Review each printed model license, then rerun with -AcknowledgeModelTerms. This does not grant redistribution permission.' }
if ($Action -eq 'Python' -and -not $AcknowledgeDependencyTerms) { throw 'Review the licenses of requirements-build.txt, the official PyTorch wheels, and TensorRT-RTX/CUDA before using -AcknowledgeDependencyTerms.' }
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile
$common = @{ WorkspaceRoot = $WorkspaceRoot; ToolchainFile = $ToolchainFile; DependencyRoot = $DependencyRoot }
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE) { throw "Command failed: $Executable (exit $LASTEXITCODE)" }
}
switch ($Action) {
    'Check' {
        $failures = @()
        foreach ($mode in 'python','native') {
            try {
                if ($mode -eq 'python') { $null = Get-ShowcaseToolchain @common -Python }
                else { $null = Get-ShowcaseToolchain @common -Native }
                Write-Output "$mode toolchain: configured"
            } catch { $failures += $_.Exception.Message; Write-Output "$mode toolchain: $($_.Exception.Message)" }
        }
        if ($tc.PythonExe -and (Test-Path -LiteralPath (Join-Path $tc.SourceRoot 'CMakeLists.txt'))) {
            & $tc.PythonExe "$PSScriptRoot/prepare-source.py" --workspace $WorkspaceRoot --source $tc.SourceRoot --check
            if ($LASTEXITCODE) { $failures += 'SDK patches are missing or do not match the qualified source.' }
        } else { $failures += 'SDK source is absent; run -Action Source.' }
        if ($failures.Count) { throw "Preflight found $($failures.Count) missing prerequisites. See showcase/BUILD_FROM_SOURCE.md." }
        Write-Output 'Configuration and source preflight passed. This does not qualify GPU inference or Python imports.'
    }
    'Source' {
        $null = Get-ShowcaseToolchain @common -Python
        $sourcePath = [IO.Path]::GetFullPath($tc.SourceRoot)
        $vendorPath = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'vendor'))
        if (-not $sourcePath.StartsWith($vendorPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source action only writes inside this example vendor directory.' }
        $manifest = Get-Content -LiteralPath "$PSScriptRoot/source-patches/manifest.json" -Raw | ConvertFrom-Json
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            $null = New-Item -ItemType Directory -Path $sourcePath -Force
            Invoke-Checked 'git' @('init',$sourcePath)
            Invoke-Checked 'git' @('-C',$sourcePath,'-c','core.autocrlf=false','fetch','--depth=1',$manifest.repository,$manifest.revision)
            Invoke-Checked 'git' @('-C',$sourcePath,'-c','core.autocrlf=false','checkout','--detach','FETCH_HEAD')
        }
        Invoke-Checked $tc.PythonExe @("$PSScriptRoot/prepare-source.py",'--workspace',$WorkspaceRoot,'--source',$sourcePath)
    }
    'Python' {
        $null = Get-ShowcaseToolchain @common -Python
        $venv = Join-Path $WorkspaceRoot '.venv'
        Invoke-Checked $tc.PythonExe @('-m','venv',$venv)
        $python = Join-Path $venv 'Scripts/python.exe'
        Invoke-Checked $python @('-m','pip','install','--index-url','https://download.pytorch.org/whl/cpu','torch==2.8.0+cpu','torchvision==0.23.0+cpu')
        Invoke-Checked $python @('-m','pip','install','-r',"$PSScriptRoot/requirements-build.txt")
        if ($Capabilities -contains 'asr') { Invoke-Checked $python @('-m','pip','install','--target',"$WorkspaceRoot/python-asr-deps",'transformers==4.57.3','numpy==2.2.6','scipy==1.16.3') }
        if ($Capabilities -contains 'understanding') { Invoke-Checked $python @('-m','pip','install','--target',"$WorkspaceRoot/models/understanding-python-deps",'transformers==4.57.6','Pillow==12.1.1','scipy==1.17.1','numpy==2.5.3') }
        Write-Output "Set PythonExe to $python in your toolchain configuration for subsequent actions."
    }
    'Download' {
        $null = Get-ShowcaseToolchain @common -Python
        Invoke-Checked $tc.PythonExe (@("$PSScriptRoot/acquire-model-licenses.py",'--workspace',$WorkspaceRoot,'--acknowledge-model-terms','--models') + $Capabilities)
        foreach ($capability in $Capabilities) {
            switch ($capability) {
                'text' { Invoke-Checked $tc.PythonExe @("$PSScriptRoot/download-text-model.py",'--workspace',$WorkspaceRoot,'--model','Qwen3-4B','--revision','1cfa9a7208912126459214e8b04321603b3df60c') }
                'asr' { Invoke-Checked $tc.PythonExe @("$PSScriptRoot/download-asr-model.py",'--workspace',$WorkspaceRoot) }
                'embedding' { Invoke-Checked $tc.PythonExe @("$PSScriptRoot/download-embedding-model.py",'--workspace',$WorkspaceRoot) }
                'vision' { Invoke-Checked $tc.PythonExe @("$PSScriptRoot/download-vision-model.py") }
                'geometry' { Invoke-Checked $tc.PythonExe @("$WorkspaceRoot/showcase/geometry-native/acquire.py") }
                'understanding' { Invoke-Checked $tc.PythonExe @("$WorkspaceRoot/showcase/understanding-native/acquire_checkpoint.py") }
                'voice' { Invoke-Checked $tc.PythonExe @("$PSScriptRoot/download-voice-model.py",'--workspace',$WorkspaceRoot) }
            }
        }
    }
    'Native' {
        $null = Get-ShowcaseToolchain @common -Python -Native
        Invoke-Checked $tc.PythonExe @("$PSScriptRoot/prepare-source.py",'--workspace',$WorkspaceRoot,'--source',$tc.SourceRoot,'--check')
        & "$PSScriptRoot/build-process-host.ps1" @common
        foreach ($capability in $Capabilities) { & "$PSScriptRoot/build-$capability-native.ps1" @common }
    }
    'Models' {
        $null = Get-ShowcaseToolchain @common -Python
        Invoke-Checked $tc.PythonExe @("$PSScriptRoot/prepare-source.py",'--workspace',$WorkspaceRoot,'--source',$tc.SourceRoot,'--check')
        foreach ($capability in $Capabilities) { & "$PSScriptRoot/build-$capability-model.ps1" @common }
    }
    'Shell' {
        if (-not (Test-Path -LiteralPath "$WorkspaceRoot/dependencies/electron/electron.exe")) { & "$PSScriptRoot/install-shell.ps1" -WorkspaceRoot $WorkspaceRoot }
        & "$PSScriptRoot/package.ps1" -WorkspaceRoot $WorkspaceRoot
    }
}
