[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ToolchainFile, [string]$DependencyRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot\models\understanding-python-deps;$WorkspaceRoot\python-deps;$source\core\builder;$source"
$env:HF_HOME = "$WorkspaceRoot\models\understanding-hf-cache"
$env:HF_HUB_OFFLINE = '1'
$bundle = Join-Path $WorkspaceRoot 'models\understanding-qwen3-vl-2b-rtx.bundle'
$receiptPath = Join-Path $WorkspaceRoot 'showcase\understanding-native\build-receipt.json'
$receipt = [ordered]@{
    model = 'Qwen/Qwen3-VL-2B-Instruct'
    revision = '89644892e4d85e24eaac8bacfd4f463576704203'
    backend = 'trt_rtx'
    precision = 'bf16'
    task = 'vision_language_generation'
    maxSequenceLength = 1024
    visionWidth = 448
    visionHeight = 448
    normalization = 'Pinned checkpoint RGB mean/std: 0.5 / 0.5'
    bundle = $bundle
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    complete = $false
}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot\models\understanding-qwen3-vl-2b" --backend trt_rtx --precision bf16 --max-sequence-length 1024 --output $bundle
if ($LASTEXITCODE) { throw 'Image-understanding model compilation failed' }
$receipt.complete = $true
$receipt['bundleBytes'] = (Get-Item -LiteralPath $bundle).Length
$receipt['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Compiled $bundle"
