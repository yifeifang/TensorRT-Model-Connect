[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ToolchainFile, [string]$DependencyRoot,
    [ValidateSet('Whisper-small')]
    [string]$ModelName = 'Whisper-small'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot\python-asr-deps;$WorkspaceRoot\python-deps;$source\core\builder;$source"
$env:HF_HOME = "$WorkspaceRoot\models\huggingface"
$bundleName = $ModelName.ToLowerInvariant() + '-rtx.bundle'
$receiptPath = Join-Path $WorkspaceRoot ('logs\' + $ModelName.ToLowerInvariant() + '-build.json')
$null = New-Item -ItemType Directory -Force -Path (Join-Path $WorkspaceRoot 'logs')
$receipt = [ordered]@{
    model = $ModelName
    backend = 'trt_rtx'
    precision = 'fp32'
    maxSequenceLength = 256
    bundle = "$WorkspaceRoot\models\$bundleName"
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    complete = $false
}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Building $ModelName on TensorRT-RTX: FP32, 256-token decoder context."
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot\models\$ModelName" --backend trt_rtx --precision fp32 --max-sequence-length 256 --output "$WorkspaceRoot\models\$bundleName"
if ($LASTEXITCODE) { throw 'ASR model compilation failed' }
$bundle = Get-Item -LiteralPath "$WorkspaceRoot\models\$bundleName"
$receipt.complete = $true
$receipt['bundleBytes'] = $bundle.Length
$receipt['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Compiled $($bundle.FullName): $($bundle.Length) bytes."
