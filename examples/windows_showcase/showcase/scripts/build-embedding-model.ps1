[CmdletBinding()]
param([string]$WorkspaceRoot, [string]$ToolchainFile, [string]$DependencyRoot)
$ErrorActionPreference = 'Stop'
if (-not $WorkspaceRoot) { $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path }
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot\models\e5-python-deps;$WorkspaceRoot\python-deps;$source\core\builder;$source"
$env:HF_HOME = "$WorkspaceRoot\models\e5-huggingface"
$bundlePath = Join-Path $WorkspaceRoot 'models\multilingual-e5-small-rtx.bundle'
$receiptPath = Join-Path $WorkspaceRoot 'models\e5-small-build.json'
$download = Get-Content -LiteralPath "$WorkspaceRoot\models\e5-small-download.json" -Raw | ConvertFrom-Json
if (-not $download.complete -or $download.revision -ne '614241f622f53c4eeff9890bdc4f31cfecc418b3') { throw 'Download and verify the pinned E5 checkpoint first.' }
$receipt = [ordered]@{model='intfloat/multilingual-e5-small';revision=$download.revision;backend='trt_rtx';precision='fp16';dimension=384;maxSequenceLength=512;bundle=$bundlePath;startedAt=(Get-Date).ToUniversalTime().ToString('o');complete=$false}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output 'Building multilingual E5 on the GPU. Coordinate the GPU slot before running this script.'
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot\models\e5-small" --backend trt_rtx --task embedding --precision fp16 --max-sequence-length 512 --output $bundlePath
if ($LASTEXITCODE) { throw 'Embedding model compilation failed' }
$receipt.complete = $true
$receipt['bundleBytes'] = (Get-Item -LiteralPath $bundlePath).Length
$receipt['sha256'] = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash
$receipt['finishedAt'] = (Get-Date).ToUniversalTime().ToString('o')
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Output "Compiled embedding model: $bundlePath"
