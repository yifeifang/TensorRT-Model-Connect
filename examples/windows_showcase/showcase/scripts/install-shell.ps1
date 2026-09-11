[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$ArchivePath = '',
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
$version = '44.3.0'
$filename = "electron-v$version-win32-x64.zip"
$expected = '26bf9a617d58d81772b3d68305d59ee48272969c15083c06db634a77358a8d9d'
$url = "https://github.com/electron/electron/releases/download/v$version/$filename"
$destination = Join-Path $WorkspaceRoot 'dependencies/electron'
if ($Plan) {
    [ordered]@{version=$version; url=$url; sha256=$expected; destination=$destination; officialNotices="https://github.com/electron/electron/releases/tag/v$version"; action='Download, verify and extract locally; no model or GPU runtime included'} | ConvertTo-Json
    return
}
if (Test-Path -LiteralPath $destination) { throw "Runtime destination already exists. Supply its path to package.ps1 using -ElectronRoot, or use a fresh example directory: $destination" }
if (!$ArchivePath) {
    $downloadRoot = Join-Path $WorkspaceRoot 'dependencies/downloads'
    New-Item -ItemType Directory -Force $downloadRoot | Out-Null
    $ArchivePath = Join-Path $downloadRoot $filename
    if (!(Test-Path -LiteralPath $ArchivePath)) { Invoke-WebRequest -Uri $url -OutFile $ArchivePath }
}
if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Desktop archive SHA-256 does not match the pinned official release.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
try {
    $prefix = [IO.Path]::GetFullPath($destination) + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $archive.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
        if (!$target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive contains a path outside the runtime directory.' }
    }
} finally { $archive.Dispose() }
Expand-Archive -LiteralPath $ArchivePath -DestinationPath $destination
foreach ($name in @('electron.exe','LICENSE','LICENSES.chromium.html','version')) {
    if (!(Test-Path -LiteralPath (Join-Path $destination $name))) { throw "Desktop runtime is missing $name" }
}
if ((Get-Content -LiteralPath (Join-Path $destination 'version') -Raw).Trim() -ne $version) { throw 'Unexpected desktop runtime version.' }
Write-Output "Installed desktop runtime $version locally. Keep its LICENSE and LICENSES.chromium.html files."
