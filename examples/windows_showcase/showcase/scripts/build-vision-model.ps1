[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ToolchainFile, [string]$DependencyRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot\models\sam-python-deps;$WorkspaceRoot\python-deps;$source\core\builder;$source"
$env:HF_HOME = "$WorkspaceRoot\models\huggingface"
$bundle = Join-Path $WorkspaceRoot 'models\sam-vit-base-rtx.bundle'
$receiptPath = Join-Path $WorkspaceRoot 'logs\sam-vit-base-build.json'
$null = New-Item -ItemType Directory -Force -Path (Join-Path $WorkspaceRoot 'logs')
$receipt = [ordered]@{
    model = 'facebook/sam-vit-base'
    backend = 'trt_rtx'
    precision = 'fp16'
    task = 'prompted_segmentation'
    bundle = $bundle
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    complete = $false
}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot\models\sam-vit-base" --backend trt_rtx --precision fp16 --output $bundle
if ($LASTEXITCODE) { throw 'SAM model compilation failed' }
$receipt.complete = $true
$receipt['bundleBytes'] = (Get-Item -LiteralPath $bundle).Length
$receipt['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Compiled $bundle"
