[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$DependencyRoot,
    [string]$ToolchainFile
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tc = Get-ShowcaseToolchain -WorkspaceRoot $WorkspaceRoot -DependencyRoot $DependencyRoot -ToolchainFile $ToolchainFile -Python
$source = $tc.SourceRoot
$env:PYTHONPATH = "$WorkspaceRoot/python-deps;$source/core/builder;$source"
$env:HF_HOME = Join-Path $WorkspaceRoot 'models/huggingface'
& $tc.PythonExe -m tensorrt_model_connect build "$WorkspaceRoot/models/Nemotron-VoiceChat-11B" --backend trt_rtx --precision fp32 --quantization int8 --max-sequence-length 512 --output "$WorkspaceRoot/models/nemotron-voicechat-rtx.bundle"
if ($LASTEXITCODE) { throw 'Voice model compilation failed' }
