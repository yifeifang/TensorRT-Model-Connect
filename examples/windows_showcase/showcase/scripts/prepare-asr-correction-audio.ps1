[CmdletBinding()]
param([string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path $WorkspaceRoot 'showcase\renderer\fixtures'
$null = New-Item -ItemType Directory -Force -Path $fixtureRoot
$wavPath = Join-Path $fixtureRoot 'dictation-correction.wav'
$sourcePath = Join-Path $fixtureRoot 'dictation-correction.source.json'
$spokenText = 'Um, send Alex a message. The demo is on Thursday. Sorry, I mean Friday at three p.m. Please ask him to bring the laptop. Uh, keep it short.'
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $synth.SelectVoice('Microsoft Zira Desktop')
    $synth.Rate = 0
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile($wavPath, $format)
    $synth.Speak($spokenText)
} finally { $synth.Dispose() }

# Inspect RIFF chunks to measure actual audio length, including optional metadata.
$bytes = [IO.File]::ReadAllBytes($wavPath)
$cursor = 12
$dataBytes = 0
while ($cursor + 8 -le $bytes.Length) {
    $chunk = [Text.Encoding]::ASCII.GetString($bytes, $cursor, 4)
    $size = [BitConverter]::ToUInt32($bytes, $cursor + 4)
    if ($cursor + 8 + $size -gt $bytes.Length) { throw 'Generated WAV has a truncated chunk.' }
    if ($chunk -eq 'data') { $dataBytes += $size }
    $cursor += 8 + $size + ($size % 2)
}
$seconds = $dataBytes / 32000.0
if ($seconds -lt 0.1 -or $seconds -ge 30) { throw "Generated audio duration must be below 30 seconds; got $seconds." }
$receipt = [ordered]@{
    file = 'dictation-correction.wav'
    source = 'Locally synthesized demonstration input; no private or third-party human recording.'
    synthesizer = 'Windows System.Speech.Synthesis.SpeechSynthesizer'
    voice = 'Microsoft Zira Desktop'
    rate = 0
    script = 'showcase/scripts/prepare-asr-correction-audio.ps1'
    reference = $spokenText
    sampleRate = 16000
    channels = 1
    format = 'signed PCM16 little-endian WAV'
    audioSeconds = $seconds
    bytes = $bytes.Length
    sha256 = (Get-FileHash -LiteralPath $wavPath -Algorithm SHA256).Hash.ToLowerInvariant()
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    purpose = 'Actual audio input for Whisper, followed by independent Qwen Thinking. The explicit correction changes Thursday to Friday at 3 p.m.; Alex and the laptop should remain. This reference is never used as ASR output.'
    licensing = 'The spoken sentence was written for this demo. The installed Windows voice software remains subject to its Microsoft license and is not redistributed with the fixture. This receipt does not claim a third-party human-recording license.'
}
$receipt | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $sourcePath -Encoding utf8
Write-Output "Generated $wavPath ($seconds seconds, $($bytes.Length) bytes)."
