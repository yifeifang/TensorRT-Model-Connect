[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ToolchainFile, [string]$DependencyRoot,
    [ValidateSet('Qwen3-0.6B', 'Qwen3-1.7B', 'Qwen3-4B', 'Qwen3-4B-Instruct-2507')]
    [string]$ModelName = 'Qwen3-4B'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot\python-deps;$source\core\builder;$source"
$env:HF_HOME = "$WorkspaceRoot\models\huggingface"
$bundleName = $ModelName.ToLowerInvariant() + '-rtx.bundle'
$receiptPath = Join-Path $WorkspaceRoot ('logs\' + $ModelName.ToLowerInvariant() + '-build.json')
$null = New-Item -ItemType Directory -Force -Path (Join-Path $WorkspaceRoot 'logs')
$receipt = [ordered]@{
    model = $ModelName
    backend = 'trt_rtx'
    precision = 'bf16'
    maxSequenceLength = 4096
    bundle = "$WorkspaceRoot\models\$bundleName"
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    complete = $false
}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Building $ModelName on TensorRT-RTX: BF16, 4096-token context."
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot\models\$ModelName" --backend trt_rtx --precision bf16 --max-sequence-length 4096 --output "$WorkspaceRoot\models\$bundleName"
if ($LASTEXITCODE) { throw 'Text model compilation failed' }
$bundle = Get-Item -LiteralPath "$WorkspaceRoot\models\$bundleName"
$receipt.complete = $true
$receipt['bundleBytes'] = $bundle.Length
$receipt['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Compiled $($bundle.FullName): $($bundle.Length) bytes."
