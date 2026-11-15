# Prepares the desktop pet's running animation (src/app/pet) from the team's 12 separate PNG frames.
#   powershell -ExecutionPolicy Bypass -File scripts/prepare-run-frames.ps1 -Source <folder with COSMO_run_01..12.png>
# For each frame: keep only the largest connected opaque blob (the crops carry a stray sliver of the next
# sprite in the top-left corner), then scale to 240x240 (2x the 120 px the pet draws) into public/mascot/run/.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [int]$Size = 240
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\mascot\run"
New-Item -ItemType Directory -Force $outDir | Out-Null

$files = Get-ChildItem $Source -Filter "COSMO_run_*.png" | Sort-Object Name
if ($files.Count -ne 12) { throw "Expected 12 COSMO_run_*.png frames in $Source, found $($files.Count)" }

foreach ($f in $files) {
  $bmp = New-Object System.Drawing.Bitmap($f.FullName)
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride

  # label 4-connected components of pixels with alpha > 20
  $label = New-Object int[] ($w * $h)
  $sizes = @{}
  $next = 0
  $stack = New-Object System.Collections.Generic.Stack[int]
  for ($i = 0; $i -lt $w * $h; $i++) {
    if ($label[$i] -ne 0) { continue }
    $x = $i % $w; $y = [math]::Floor($i / $w)
    if ($bytes[$y * $stride + $x * 4 + 3] -le 20) { continue }
    $next++; $count = 0
    $label[$i] = $next; $stack.Push($i)
    while ($stack.Count -gt 0) {
      $p = $stack.Pop(); $count++
      $px = $p % $w; $py = [math]::Floor($p / $w)
      foreach ($d in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
        $nx = $px + $d[0]; $ny = $py + $d[1]
        if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) { continue }
        $q = $ny * $w + $nx
        if ($label[$q] -ne 0) { continue }
        if ($bytes[$ny * $stride + $nx * 4 + 3] -le 20) { continue }
        $label[$q] = $next; $stack.Push($q)
      }
    }
    $sizes[$next] = $count
  }
  $keep = ($sizes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
  # clear every opaque pixel that is not part of the main body; faint (alpha <= 20) edge pixels are left alone
  for ($i = 0; $i -lt $w * $h; $i++) {
    if ($label[$i] -ne 0 -and $label[$i] -ne $keep) {
      $x = $i % $w; $y = [math]::Floor($i / $w)
      $bytes[$y * $stride + $x * 4 + 3] = 0
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)

  $out = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.DrawImage($bmp, 0, 0, $Size, $Size)
  $g.Dispose()
  $n = $f.BaseName -replace "COSMO_run_", ""
  $dest = Join-Path $outDir "run-$n.png"
  $out.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose(); $bmp.Dispose()
  Write-Output "$($f.Name): $($sizes.Count) blobs, kept #$keep ($($sizes[$keep]) px) -> $dest"
}
