[CmdletBinding()]
param([string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
      [string]$ElectronRoot = '',
      [switch]$IncludeLocalSamples)
$ErrorActionPreference = 'Stop'
if (!$ElectronRoot) { $ElectronRoot = Join-Path $WorkspaceRoot 'dependencies/electron' }
$output = Join-Path $WorkspaceRoot 'dist\ModelConnect Showcase'
if (!(Test-Path -LiteralPath (Join-Path $ElectronRoot 'electron.exe'))) { throw 'Install the desktop runtime with showcase/scripts/install-shell.ps1, or pass -ElectronRoot.' }
foreach ($required in @('LICENSE','LICENSES.chromium.html')) {
    if (!(Test-Path -LiteralPath (Join-Path $ElectronRoot $required))) { throw "Desktop runtime is missing its required notice: $required" }
}
New-Item -ItemType Directory -Force $output | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $ElectronRoot) {
    if ($entry.Name -eq 'electron.exe') { continue }
    Copy-Item -LiteralPath $entry.FullName -Destination $output -Recurse -Force
}
$appRoot = Join-Path $output 'resources\app'
$resolvedAppRoot = [IO.Path]::GetFullPath($appRoot)
$expectedAppRoot = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'dist\ModelConnect Showcase\resources\app'))
if ($resolvedAppRoot -ne $expectedAppRoot -or !$resolvedAppRoot.StartsWith([IO.Path]::GetFullPath($WorkspaceRoot) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid generated app directory.' }
if (Test-Path -LiteralPath $resolvedAppRoot) { Remove-Item -LiteralPath $resolvedAppRoot -Recurse -Force }
New-Item -ItemType Directory -Force $appRoot | Out-Null
foreach ($name in @('package.json','capabilities-main.js','capabilities-preload.js','capabilities.js','capability-runtime.js','capability-data.js','geometry-data.js','presentation-error.js','png.js','bridge-client.js','voice-protocol.js','transcript-store.js')) {
    Copy-Item -LiteralPath (Join-Path $WorkspaceRoot "showcase\$name") -Destination $appRoot -Recurse -Force
}
$rendererRoot = Join-Path $appRoot 'renderer'
New-Item -ItemType Directory -Force $rendererRoot | Out-Null
foreach ($name in @('capabilities.html','capabilities.js','capabilities.css','styles.css','audio.js','dictation-audio.js','capture-worklet.js','geometry-view.js')) {
    Copy-Item -LiteralPath (Join-Path $WorkspaceRoot "showcase\renderer\$name") -Destination $rendererRoot -Recurse -Force
}
$fixtureRoot = Join-Path $rendererRoot 'fixtures'
New-Item -ItemType Directory -Force $fixtureRoot | Out-Null
foreach ($name in @('vision-car.jpeg','vision-car.LICENSE.txt','ATTRIBUTION.md')) {
    Copy-Item -LiteralPath (Join-Path $WorkspaceRoot "showcase\renderer\fixtures\$name") -Destination $fixtureRoot -Force
}
if ($IncludeLocalSamples) {
    foreach ($name in @('dictation-en.wav','dictation-correction.wav','dictation-correction.source.json','geometry-house.jpg','geometry-house.source.json','geometry-house.LICENSE.txt')) {
        $sample = Join-Path $WorkspaceRoot "showcase/renderer/fixtures/$name"
        if (Test-Path -LiteralPath $sample) { Copy-Item -LiteralPath $sample -Destination $fixtureRoot -Force }
    }
    Write-Warning 'Local samples were included for local use. Their redistribution rights have not been established by this package script.'
}
$legal = Join-Path $output 'licenses/ModelConnect'
New-Item -ItemType Directory -Force $legal | Out-Null
foreach ($name in @('LICENSE','NOTICE')) {
    Copy-Item -LiteralPath (Join-Path $WorkspaceRoot $name) -Destination $legal -Force
}
$distribution = Join-Path $WorkspaceRoot 'showcase/distribution'
foreach ($name in @('COMPONENT_LICENSE_AUDIT.md','MODEL_LICENSE_AUDIT.md','model-licenses.json')) {
    Copy-Item -LiteralPath (Join-Path $distribution $name) -Destination $legal -Force
}
'This is a locally assembled desktop shell. Model weights and GPU runtimes are installed separately. Re-distribution of this directory requires review of Electron/Chromium/FFmpeg and all added runtime and model terms. See licenses/ModelConnect.' | Set-Content -LiteralPath (Join-Path $output 'LOCAL_BUILD.txt') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $ElectronRoot 'electron.exe') -Destination (Join-Path $output 'ModelConnect Showcase.exe') -Force
$unbrandedExecutable = Join-Path $output 'electron.exe'
if (Test-Path -LiteralPath $unbrandedExecutable) { Remove-Item -LiteralPath $unbrandedExecutable }
Write-Output (Join-Path $output 'ModelConnect Showcase.exe')
