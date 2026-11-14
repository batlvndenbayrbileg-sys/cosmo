<#
.SYNOPSIS
  Prepares the Cosmo mascot renders for the web app and (optionally) measures them.

.DESCRIPTION
  The team's original PNG renders live outside the repo (default C:\Users\<you>\Downloads\mascot).
  This script only READS them. It writes downscaled copies with alpha kept into public\mascot\
  (long edge 900 px, high-quality bicubic, premultiplied alpha so the soft glow edge gets no dark
  fringe). The originals are never modified, moved or deleted.

  Poses used by src/components/cosmo/ImageCosmo.tsx (see mascot-poses.ts for why these two):
    front  : "Glossy Cosmo Robot Waving-5.png"          -> public\mascot\cosmo-front.png
    three  : "Glossy Cosmo Robot with Neon Glow-4.png"  -> public\mascot\cosmo-three-quarter.png

  With -Measure it also analyses the DOWNSCALED copies with System.Drawing and prints, per pose,
  the numbers stored in src/components/cosmo/mascot-poses.ts (all normalised 0..1 of the image
  width / height): the dark visor ellipse (centre, radii, rotation, fit quality), its dark colour,
  the two baked-in eye shapes, ear rings, collar and feet glows. Update mascot-poses.ts from the
  JSON if a render is replaced.

.PARAMETER Source
  Folder with the original renders.
.PARAMETER Dest
  Output folder (default: public\mascot in the repo root).
.PARAMETER LongEdge
  Long edge in pixels of the copies (default 900).
.PARAMETER Measure
  Also print the pose measurements as JSON.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\prepare-mascot.ps1
  powershell -ExecutionPolicy Bypass -File scripts\prepare-mascot.ps1 -Measure
#>
[CmdletBinding()]
param(
  [string]$Source = (Join-Path $env:USERPROFILE 'Downloads\mascot'),
  [string]$Dest = '',
  [int]$LongEdge = 900,
  [switch]$Measure
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Dest)) { $Dest = Join-Path $repoRoot 'public\mascot' }
if (-not (Test-Path -LiteralPath $Source)) { throw "Source folder not found: $Source" }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$poses = @(
  @{ Name = 'front'; In = 'Glossy Cosmo Robot Waving-5.png'; Out = 'cosmo-front.png' },
  @{ Name = 'three-quarter'; In = 'Glossy Cosmo Robot with Neon Glow-4.png'; Out = 'cosmo-three-quarter.png' }
)

function Save-Downscaled([string]$inPath, [string]$outPath, [int]$longEdge) {
  $src = [System.Drawing.Image]::FromFile($inPath)   # read-only use of the original
  try {
    $scale = [Math]::Min(1.0, $longEdge / [double][Math]::Max($src.Width, $src.Height))
    $w = [int][Math]::Round($src.Width * $scale)
    $h = [int][Math]::Round($src.Height * $scale)
    # PArgb = premultiplied alpha: resampling transparent edges does not drag in black.
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($src, 0, 0, $w, $h)
      } finally { $g.Dispose() }
      $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
    return ("{0}x{1} -> {2}x{3}" -f $src.Width, $src.Height, $w, $h)
  } finally { $src.Dispose() }
}

foreach ($p in $poses) {
  $inPath = Join-Path $Source $p.In
  if (-not (Test-Path -LiteralPath $inPath)) { throw "Missing original: $inPath" }
  $outPath = Join-Path $Dest $p.Out
  $info = Save-Downscaled $inPath $outPath $LongEdge
  $kb = [Math]::Round((Get-Item -LiteralPath $outPath).Length / 1024)
  Write-Host ("{0,-14} {1}  ({2} KB)  {3}" -f $p.Name, $info, $kb, $outPath)
}

if (-not $Measure) { return }

# ---------------------------------------------------------------------------------------------
# Measurement (System.Drawing + a small C# helper for fast pixel access)
# ---------------------------------------------------------------------------------------------
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Text;

public class Blob {
  public int MinX, MinY, MaxX, MaxY, Area;
  public double Cx, Cy;
}

public class MascotImage {
  public int W, H;
  public byte[] Px; // BGRA, tightly packed

  public MascotImage(string path) {
    using (Bitmap src = new Bitmap(path))
    using (Bitmap bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) {
        g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
        g.DrawImage(src, 0, 0, src.Width, src.Height);
      }
      W = bmp.Width; H = bmp.Height;
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      if (d.Stride != W * 4) throw new Exception("unexpected stride");
      Px = new byte[d.Stride * H];
      System.Runtime.InteropServices.Marshal.Copy(d.Scan0, Px, 0, Px.Length);
      bmp.UnlockBits(d);
    }
  }

  public void Get(int x, int y, out int r, out int g, out int b, out int a) {
    int i = (y * W + x) * 4; b = Px[i]; g = Px[i + 1]; r = Px[i + 2]; a = Px[i + 3];
  }
  public double Lum(int x, int y) {
    int r, g, b, a; Get(x, y, out r, out g, out b, out a);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  public bool IsNeon(int x, int y) {
    int r, g, b, a; Get(x, y, out r, out g, out b, out a);
    if (a < 200) return false;
    int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
    return mx >= 170 && (mx - mn) >= 0.38 * mx;
  }

  // Dark visor: connected set of dark opaque pixels grown from a seed. Eyes are bright, so they
  // are holes; rows are filled between the leftmost and rightmost dark pixel afterwards.
  public bool[] DarkRegion(int sx, int sy, double lumMax) {
    bool[] seen = new bool[W * H];
    Stack<int> st = new Stack<int>();
    // the seed may sit on an eye: walk down until a dark pixel is found
    while (sy < H - 1 && !(Lum(sx, sy) < lumMax && Px[(sy * W + sx) * 4 + 3] > 200)) sy++;
    st.Push(sy * W + sx); seen[sy * W + sx] = true;
    while (st.Count > 0) {
      int p = st.Pop(); int x = p % W, y = p / W;
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) continue;
        int nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        int q = ny * W + nx; if (seen[q]) continue;
        if (Lum(nx, ny) < lumMax && Px[q * 4 + 3] > 200) { seen[q] = true; st.Push(q); }
      }
    }
    return seen;
  }

  public static void FillRows(bool[] m, int w, int h) {
    for (int y = 0; y < h; y++) {
      int lo = -1, hi = -1;
      for (int x = 0; x < w; x++) if (m[y * w + x]) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) for (int x = lo; x <= hi; x++) m[y * w + x] = true;
    }
  }

  public static string Num(double v) { return v.ToString("0.####", CultureInfo.InvariantCulture); }

  // second-moment ellipse fit of a mask; iou = overlap of the fitted ellipse and the mask
  public string FitEllipse(bool[] m, out double iou, out double cxOut, out double cyOut) {
    double n = 0, sx = 0, sy = 0;
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (m[y * W + x]) { n++; sx += x; sy += y; }
    double cx = sx / n, cy = sy / n, sxx = 0, syy = 0, sxy = 0;
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (m[y * W + x]) {
      double dx = x - cx, dy = y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    double tr = sxx + syy, det = sxx * syy - sxy * sxy;
    double root = Math.Sqrt(Math.Max(0, tr * tr / 4 - det));
    double rA = 2 * Math.Sqrt(tr / 2 + root), rB = 2 * Math.Sqrt(Math.Max(0.0001, tr / 2 - root));
    double ang = 0.5 * Math.Atan2(2 * sxy, sxx - syy); // major axis direction (radians, y down)
    double inter = 0, uni = 0, ca = Math.Cos(ang), sa = Math.Sin(ang);
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
      double dx = x - cx, dy = y - cy;
      double u = (dx * ca + dy * sa) / rA, v = (-dx * sa + dy * ca) / rB;
      bool inE = u * u + v * v <= 1.0;
      bool inM = m[y * W + x];
      if (inE && inM) inter++;
      if (inE || inM) uni++;
    }
    iou = inter / uni; cxOut = cx; cyOut = cy;
    double rot = ang * 180.0 / Math.PI;
    double rx, ry, rotX;
    if (Math.Abs(rot) <= 45) { rx = rA; ry = rB; rotX = rot; }
    else { rx = rB; ry = rA; rotX = rot > 0 ? rot - 90 : rot + 90; }
    // rx, ry in image-width / image-height units (the SVG overlay uses a 0..W x 0..H box)
    return "\"cx\":" + Num(cx / W) + ",\"cy\":" + Num(cy / H) + ",\"rx\":" + Num(rx / W) + ",\"ry\":" + Num(ry / H) +
           ",\"rotationDeg\":" + Num(rotX);
  }

  // boundary of a row-filled mask sampled at n angles around (cx, cy): normalised polygon
  public string Polygon(bool[] m, double cx, double cy, int n) {
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      double a = 2 * Math.PI * i / n, dx = Math.Cos(a), dy = Math.Sin(a), t = 0;
      while (true) {
        int x = (int)Math.Round(cx + dx * (t + 1)), y = (int)Math.Round(cy + dy * (t + 1));
        if (x < 0 || y < 0 || x >= W || y >= H || !m[y * W + x]) break;
        t++;
      }
      if (i > 0) sb.Append(",");
      sb.Append("[" + Num((cx + dx * t) / W) + "," + Num((cy + dy * t) / H) + "]");
    }
    return sb.Append("]").ToString();
  }

  // neon blobs in a pixel rectangle; 8-connected after growing by `gap` to merge ring pieces
  public List<Blob> NeonBlobs(int x0, int y0, int x1, int y1, int gap, int minArea, bool[] exclude) {
    int w = x1 - x0 + 1, h = y1 - y0 + 1;
    bool[] raw = new bool[w * h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int gx = x0 + x, gy = y0 + y;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
      if (exclude != null && exclude[gy * W + gx]) continue;
      raw[y * w + x] = IsNeon(gx, gy);
    }
    bool[] grown = new bool[w * h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (raw[y * w + x])
      for (int dy = -gap; dy <= gap; dy++) for (int dx = -gap; dx <= gap; dx++) {
        int nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) grown[ny * w + nx] = true;
      }
    bool[] seen = new bool[w * h];
    List<Blob> res = new List<Blob>();
    for (int s = 0; s < w * h; s++) {
      if (!grown[s] || seen[s]) continue;
      Blob b = new Blob(); b.MinX = int.MaxValue; b.MinY = int.MaxValue; b.MaxX = -1; b.MaxY = -1;
      double sx = 0, sy = 0; Stack<int> st = new Stack<int>(); st.Push(s); seen[s] = true;
      while (st.Count > 0) {
        int p = st.Pop(); int x = p % w, y = p / w;
        if (raw[p]) {
          b.Area++; sx += x; sy += y;
          if (x < b.MinX) b.MinX = x;
          if (x > b.MaxX) b.MaxX = x;
          if (y < b.MinY) b.MinY = y;
          if (y > b.MaxY) b.MaxY = y;
        }
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          int q = ny * w + nx; if (!seen[q] && grown[q]) { seen[q] = true; st.Push(q); }
        }
      }
      if (b.Area >= minArea) {
        b.MinX += x0; b.MaxX += x0; b.MinY += y0; b.MaxY += y0;
        b.Cx = sx / b.Area + x0; b.Cy = sy / b.Area + y0; res.Add(b);
      }
    }
    return res;
  }

  public string BlobJson(Blob b) {
    return "{\"x\":" + Num((double)b.MinX / W) + ",\"y\":" + Num((double)b.MinY / H) +
           ",\"w\":" + Num((double)(b.MaxX - b.MinX + 1) / W) + ",\"h\":" + Num((double)(b.MaxY - b.MinY + 1) / H) +
           ",\"cx\":" + Num(b.Cx / W) + ",\"cy\":" + Num(b.Cy / H) + ",\"area\":" + b.Area +
           ",\"color\":\"" + AvgNeon(b.MinX, b.MinY, b.MaxX, b.MaxY) + "\"}";
  }

  public string AvgNeon(int x0, int y0, int x1, int y1) {
    double sr = 0, sg = 0, sb = 0, n = 0;
    for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) if (IsNeon(x, y)) {
      int r, g, b, a; Get(x, y, out r, out g, out b, out a); sr += r; sg += g; sb += b; n++;
    }
    if (n == 0) return "#000000";
    return "#" + ((int)(sr / n)).ToString("X2") + ((int)(sg / n)).ToString("X2") + ((int)(sb / n)).ToString("X2");
  }

  public string MedianDark(bool[] m, bool[] exclude) {
    List<int> rs = new List<int>(), gs = new List<int>(), bs = new List<int>();
    for (int y = 0; y < H; y += 2) for (int x = 0; x < W; x += 2) {
      if (!m[y * W + x] || (exclude != null && exclude[y * W + x])) continue;
      int r, g, b, a; Get(x, y, out r, out g, out b, out a); rs.Add(r); gs.Add(g); bs.Add(b);
    }
    if (rs.Count == 0) return "#000000";
    rs.Sort(); gs.Sort(); bs.Sort(); int k = rs.Count / 2;
    return "#" + rs[k].ToString("X2") + gs[k].ToString("X2") + bs[k].ToString("X2");
  }

  // median colour of dark visor pixels in a horizontal band (rows y-half..y+half, columns x0..x1),
  // away from the eyes: the visor glass is a vertical gradient, so the patch over the eyes needs the
  // colour at several heights, not one median
  public string BandMedian(bool[] m, bool[] exclude, int y, int half, int x0, int x1) {
    List<int> rs = new List<int>(), gs = new List<int>(), bs = new List<int>();
    for (int yy = Math.Max(0, y - half); yy <= Math.Min(H - 1, y + half); yy++)
      for (int x = Math.Max(0, x0); x <= Math.Min(W - 1, x1); x++) {
        int i = yy * W + x;
        if (!m[i] || exclude[i]) continue;
        int r, g, b, a; Get(x, yy, out r, out g, out b, out a);
        if (0.2126 * r + 0.7152 * g + 0.0722 * b > 70) continue;
        rs.Add(r); gs.Add(g); bs.Add(b);
      }
    if (rs.Count == 0) return "#000000";
    rs.Sort(); gs.Sort(); bs.Sort(); int k = rs.Count / 2;
    return "#" + rs[k].ToString("X2") + gs[k].ToString("X2") + bs[k].ToString("X2");
  }

  public bool[] Around(Blob[] blobs, int pad) {
    bool[] o = new bool[W * H];
    foreach (Blob b in blobs)
      for (int y = Math.Max(0, b.MinY - pad); y <= Math.Min(H - 1, b.MaxY + pad); y++)
        for (int x = Math.Max(0, b.MinX - pad); x <= Math.Min(W - 1, b.MaxX + pad); x++) o[y * W + x] = true;
    return o;
  }

  public int[] Bounds(bool[] m) {
    int x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (m[y * W + x]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return new int[] { x0, y0, x1, y1 };
  }
}
'@

# Search windows (normalised box: x0 y0 x1 y1 of the image) in which each neon part is looked up.
# Picked by eye from the renders; the script then snaps to the real glowing pixels inside them.
$layout = @{
  'front' = @{
    VisorSeed = @(0.50, 0.36)
    EarLeft   = @(0.12, 0.20, 0.27, 0.45)
    EarRight  = @(0.78, 0.22, 0.90, 0.45)
    Collar    = @(0.36, 0.50, 0.66, 0.56)
    FootLeft  = @(0.28, 0.88, 0.45, 0.94)
    FootRight = @(0.55, 0.88, 0.72, 0.94)
  }
  'three-quarter' = @{
    VisorSeed = @(0.60, 0.36)
    EarLeft   = @(0.16, 0.20, 0.33, 0.45)
    EarRight  = @(0.78, 0.25, 0.86, 0.45)
    Collar    = @(0.40, 0.49, 0.68, 0.55)
    FootLeft  = @(0.36, 0.88, 0.52, 0.94)
    FootRight = @(0.58, 0.88, 0.72, 0.94)
  }
}

foreach ($p in $poses) {
  $img = New-Object MascotImage((Join-Path $Dest $p.Out))
  $L = $layout[$p.Name]
  $W = $img.W; $H = $img.H
  $dark = $img.DarkRegion([int]($L.VisorSeed[0] * $W), [int]($L.VisorSeed[1] * $H), 70.0)
  [MascotImage]::FillRows($dark, $W, $H)
  $iou = 0.0; $vcx = 0.0; $vcy = 0.0
  $ell = $img.FitEllipse($dark, [ref]$iou, [ref]$vcx, [ref]$vcy)
  $poly = $img.Polygon($dark, $vcx, $vcy, 36)
  $vb = $img.Bounds($dark)

  # eyes: the two biggest neon blobs inside the visor, left to right
  $eyes = $img.NeonBlobs($vb[0], $vb[1], $vb[2], $vb[3], 4, 150, $null)
  $eyes = @($eyes | Sort-Object -Property Area -Descending | Select-Object -First 2 | Sort-Object -Property Cx)
  $eyeJson = ($eyes | ForEach-Object { $img.BlobJson($_) }) -join ','
  $eyeColors = ($eyes | ForEach-Object {
      $ew = $_.MaxX - $_.MinX + 1
      $left = $img.AvgNeon($_.MinX, $_.MinY, $_.MinX + [int]($ew * 0.2), $_.MaxY)
      $right = $img.AvgNeon($_.MaxX - [int]($ew * 0.2), $_.MinY, $_.MaxX, $_.MaxY)
      "{`"leftEnd`":`"$left`",`"rightEnd`":`"$right`"}"
    }) -join ','

  # visor dark colour: median of the dark pixels away from the eyes (glare is brighter, so excluded
  # by the median anyway)
  $excl = $img.Around([Blob[]]$eyes, 30)
  $darkColor = $img.MedianDark($dark, $excl)

  # vertical colour profile of the glass at the eyes (top of the halo, eye centre line, bottom of the halo)
  $ey0 = ($eyes | ForEach-Object { $_.MinY } | Measure-Object -Minimum).Minimum
  $ey1 = ($eyes | ForEach-Object { $_.MaxY } | Measure-Object -Maximum).Maximum
  $ex0 = ($eyes | ForEach-Object { $_.MinX } | Measure-Object -Minimum).Minimum - 40
  $ex1 = ($eyes | ForEach-Object { $_.MaxX } | Measure-Object -Maximum).Maximum + 40
  $yTop = $ey0 - 40; $yMid = [int](($ey0 + $ey1) / 2); $yBot = $ey1 + 40
  $glass = '"glass":{"top":{"y":' + [Math]::Round($yTop / $H, 4) + ',"color":"' + $img.BandMedian($dark, $excl, $yTop, 6, $ex0, $ex1) + '"},' +
    '"mid":{"y":' + [Math]::Round($yMid / $H, 4) + ',"color":"' + $img.BandMedian($dark, $excl, $yMid, 6, $ex0, $ex1) + '"},' +
    '"bottom":{"y":' + [Math]::Round($yBot / $H, 4) + ',"color":"' + $img.BandMedian($dark, $excl, $yBot, 6, $ex0, $ex1) + '"}}'

  $parts = @()
  foreach ($pair in @(@('earLeft', $L.EarLeft), @('earRight', $L.EarRight), @('collar', $L.Collar), @('footLeft', $L.FootLeft), @('footRight', $L.FootRight))) {
    $box = $pair[1]
    $bl = $img.NeonBlobs([int]($box[0] * $W), [int]($box[1] * $H), [int]($box[2] * $W), [int]($box[3] * $H), 3, 80, $dark)
    if ($bl.Count -eq 0) { $parts += ('"' + $pair[0] + '":null') }
    else {
      $best = $bl | Sort-Object -Property Area -Descending | Select-Object -First 1
      $parts += ('"' + $pair[0] + '":' + $img.BlobJson($best))
    }
  }

  Write-Output ("== " + $p.Name)
  Write-Output ('{"image":{"width":' + $W + ',"height":' + $H + '},"visor":{' + $ell + ',"fitIoU":' + [Math]::Round($iou, 4) +
    ',"darkColor":"' + $darkColor + '","polygon36":' + $poly + '},"eyes":[' + $eyeJson + '],"eyeEndColors":[' + $eyeColors + '],' + $glass + ',' +
    ($parts -join ',') + '}')
}
