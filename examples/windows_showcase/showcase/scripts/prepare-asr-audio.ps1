[CmdletBinding()]
param([string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference = 'Stop'
$fixtures = Join-Path $WorkspaceRoot 'showcase\asr-native\fixtures'
$null = New-Item -ItemType Directory -Force -Path $fixtures
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $synth.SelectVoice('Microsoft Zira Desktop')
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile((Join-Path $fixtures 'english-demo.wav'), $format)
    $synth.Speak('Please send the project report by Friday. The customer meeting is on Monday.')
} finally { $synth.Dispose() }
$rendererFixtures = Join-Path $WorkspaceRoot 'showcase/renderer/fixtures'
New-Item -ItemType Directory -Force $rendererFixtures | Out-Null
Copy-Item -LiteralPath (Join-Path $fixtures 'english-demo.wav') -Destination (Join-Path $rendererFixtures 'dictation-en.wav') -Force
Write-Output (Join-Path $fixtures 'english-demo.wav')
