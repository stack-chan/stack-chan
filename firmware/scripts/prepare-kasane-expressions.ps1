param([string]$PreviewDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$setup = Join-Path $PSScriptRoot '../host/modules/muse-gadget/setup-device'
$out = Join-Path $setup 'assets'
$metadataPath = Join-Path $setup 'kasane-frames.js'
$metadataJson = 'import { pathToFileURL } from "node:url"; const { default: atlas } = await import(pathToFileURL(process.argv[2]).href); process.stdout.write(JSON.stringify(atlas));' | & node --input-type=module - $metadataPath
if ($LASTEXITCODE -ne 0) { throw 'Could not load face atlas' }
$meta = $metadataJson | ConvertFrom-Json
$expressions = @{}
$lenses = @(@(135,158,23,25,215,155,33,25),@(579,154,32,25,672,154,34,25),@(1047,155,34,25,1129,157,22,25),@(134,608,23,27,216,605,33,27),@(578,606,33,27,673,606,34,27),@(1047,607,34,27,1129,606,22,27),@(133,1057,23,25,214,1065,33,26),@(579,1066,33,26,674,1066,34,26),@(1049,1069,34,26,1129,1057,23,25))
$mouths = @(@(170,205),@(627,203),@(1097,206),@(171,655),@(627,655),@(1096,655),@(173,1105),@(627,1107),@(1094,1105))
foreach ($name in @('happy','sad')) {
  $sheets = @()
  foreach ($suffix in @('', '-animation')) {
    $sheet = [Drawing.Bitmap]::FromFile((Join-Path $setup "artwork/nine-$name$suffix.png"))
    if ($sheet.Width -ne 1254 -or $sheet.Height -ne 1254) { throw 'Expected 1254px square source' }
    $sheets += ,$sheet
  }
  $frames = @()
  $preview = [Drawing.Bitmap]::new(1398,1398)
  $pg = [Drawing.Graphics]::FromImage($preview)
  for ($i=0; $i -lt 9; $i++) {
    $col = $i % 3; $row = [int][Math]::Floor($i / 3)
    $sx = $col * 418 + 40; $sy = $row * 418
    $views = @()
    foreach ($sheet in $sheets) {
      $view = [Drawing.Bitmap]::new(466,466,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $g = [Drawing.Graphics]::FromImage($view)
      $g.Clear([Drawing.Color]::FromArgb(16,24,32))
      $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($sheet,[Drawing.Rectangle]::new(0,0,466,466),[Drawing.Rectangle]::new($sx,$sy,338,338),[Drawing.GraphicsUnit]::Pixel)
      $g.Dispose(); $views += ,$view
    }
    $texture = "kasane-$name-$i.png"
    $views[0].Save((Join-Path $out $texture),[Drawing.Imaging.ImageFormat]::Png)
    $eye = $meta.frames[$i].eyes
    $mouth = @{
      x = [int][Math]::Round(($mouths[$i][0]-$sx)*466/338)-36
      y = [int][Math]::Round(($mouths[$i][1]-$sy)*466/338)-26
      width = 72; height = 52; texture = "kasane-$name-mouth-$i.png"
    }
    $patches = @{
      eyes = @{x=$eye.x; y=$eye.y; width=$eye.width; height=$eye.height; texture="kasane-$name-eyes-$i.png"}
      mouth = $mouth
    }
    $pristine = $views[0].Clone()
    $g = [Drawing.Graphics]::FromImage($views[0])
    foreach ($part in @('eyes','mouth')) {
      $p = $patches[$part]
      $rect = [Drawing.Rectangle]::new($p.x,$p.y,$p.width,$p.height)
      $patch = [Drawing.Bitmap]::new($p.width,$p.height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
      for ($py=0; $py -lt $p.height; $py++) { for ($px=0; $px -lt $p.width; $px++) {
        $mix = 0
        if ($part -eq 'mouth') {
          $radius = [Math]::Sqrt([Math]::Pow(($px-36)/36,2)+[Math]::Pow(($py-26)/26,2))
          $mix = [Math]::Max(0,[Math]::Min(1,(1-$radius)/0.15))
        } else {
          $sourceX = ($p.x+$px)*338/466+$sx; $sourceY = ($p.y+$py)*338/466+$sy
          $lens = $lenses[$i]
          foreach ($k in @(0,4)) {
            $radius = [Math]::Sqrt([Math]::Pow(($sourceX-$lens[$k])/($lens[$k+2]+3),2)+[Math]::Pow(($sourceY-$lens[$k+1])/($lens[$k+3]+6),2))
            $mix = [Math]::Max($mix,[Math]::Max(0,[Math]::Min(1,(1-$radius)/0.08)))
          }
        }
        $color = $views[1].GetPixel($p.x+$px,$p.y+$py)
        $patch.SetPixel($px,$py,[Drawing.Color]::FromArgb([int](255*$mix),$color.R,$color.G,$color.B))
      } }
      $opaque = $pristine.Clone($rect,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $composite = [Drawing.Graphics]::FromImage($opaque)
      $composite.DrawImageUnscaled($patch,0,0)
      $composite.Dispose()
      $opaque.Save((Join-Path $out $p.texture),[Drawing.Imaging.ImageFormat]::Png)
      $opaque.Dispose()
      $g.DrawImageUnscaled($patch,$p.x,$p.y)
      $patch.Dispose()
    }
    $g.Dispose()
    $pristine.Dispose()
    $pg.DrawImageUnscaled($views[0],$col*466,$row*466)
    $frames += @{texture=$texture; eyes=$patches.eyes; mouth=$mouth}
    foreach ($view in $views) { $view.Dispose() }
  }
  $pg.Dispose()
  if ($PreviewDirectory) {
    New-Item -ItemType Directory -Force $PreviewDirectory | Out-Null
    $preview.Save((Join-Path $PreviewDirectory "$name-animation.png"),[Drawing.Imaging.ImageFormat]::Png)
  }
  $preview.Dispose()
  foreach ($sheet in $sheets) { $sheet.Dispose() }
  $expressions[$name] = $frames
}
$meta | Add-Member -Force -NotePropertyName expressions -NotePropertyValue $expressions
[IO.File]::WriteAllText($metadataPath,"export default $(ConvertTo-Json $meta -Depth 8)`n")
