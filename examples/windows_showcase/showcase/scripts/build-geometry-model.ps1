[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ToolchainFile, [string]$DependencyRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot\models\geometry-python-deps;$WorkspaceRoot\models\sam-python-deps;$WorkspaceRoot\python-deps;$source\core\builder;$source"
$env:HF_HOME = "$WorkspaceRoot\models\geometry-huggingface"
$bundle = Join-Path $WorkspaceRoot 'models\geometry-moge-2-vitl-rtx.bundle'
$receiptPath = Join-Path $WorkspaceRoot 'models\geometry-build.json'
$download = Get-Content -LiteralPath "$WorkspaceRoot\models\geometry-download.json" -Raw | ConvertFrom-Json
if (-not $download.complete -or $download.revision -ne '39c4d5e957afe587e04eec59dc2bcc3be5ecd968') { throw 'Download and verify the pinned geometry checkpoint first.' }
& $tc.PythonExe "$WorkspaceRoot/showcase/scripts/prepare-source.py" --workspace $WorkspaceRoot --source $source --check
if ($LASTEXITCODE) { throw 'Geometry FP32 attention patch preparation failed' }
$receipt = [ordered]@{model='Ruicheng/moge-2-vitl';revision=$download.revision;backend='trt_rtx';precision='fp32';task='monocular_geometry';bundle=$bundle;startedAt=(Get-Date).ToUniversalTime().ToString('o');complete=$false}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output 'Building the geometry model on the GPU. Coordinate the GPU slot before running this script.'
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot\models\geometry-moge-2-vitl" --backend trt_rtx --task monocular_geometry --precision fp32 --output $bundle
if ($LASTEXITCODE) { throw 'Geometry model compilation failed' }
$receipt.complete = $true
$receipt['bundleBytes'] = (Get-Item -LiteralPath $bundle).Length
$receipt['sha256'] = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash
$receipt['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Compiled geometry model: $bundle"
