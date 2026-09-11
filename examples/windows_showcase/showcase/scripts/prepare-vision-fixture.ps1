[CmdletBinding()]
param([string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = Join-Path $WorkspaceRoot 'vendor\ModelConnect\families\sam\tests\data\test_img.jpeg'
$destination = Join-Path $WorkspaceRoot 'showcase\vision-native\test-image.ppm'
$bitmap = [System.Drawing.Bitmap]::new($source)
try {
    $stream = [System.IO.File]::Create($destination)
    try {
        $header = [System.Text.Encoding]::ASCII.GetBytes("P6`n$($bitmap.Width) $($bitmap.Height)`n255`n")
        $stream.Write($header, 0, $header.Length)
        $pixels = [byte[]]::new($bitmap.Width * $bitmap.Height * 3)
        $index = 0
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                $pixel = $bitmap.GetPixel($x, $y)
                $pixels[$index++] = $pixel.R
                $pixels[$index++] = $pixel.G
                $pixels[$index++] = $pixel.B
            }
        }
        $stream.Write($pixels, 0, $pixels.Length)
    } finally { $stream.Dispose() }
    [ordered]@{source=$source; imagePath=$destination; width=$bitmap.Width; height=$bitmap.Height; license='Apache-2.0'} | ConvertTo-Json
} finally { $bitmap.Dispose() }
