# Creates a desktop shortcut for CIQ Dashboard with the app icon

Add-Type -AssemblyName System.Drawing

# --- Generate .ico from the app's SVG favicon ---
$icoPath = Join-Path $PSScriptRoot "app-icon.ico"

# Draw the orange diamond icon as a 256x256 bitmap with proper transparency
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.CompositingMode = 'SourceOver'
$g.CompositingQuality = 'HighQuality'

# Start fully transparent
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

# Draw orange diamond
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
[float]$cx = 128.0
[float]$half = 100.0
[System.Drawing.PointF[]]$points = @(
    (New-Object System.Drawing.PointF ($cx, ($cx - $half))),
    (New-Object System.Drawing.PointF (($cx + $half), $cx)),
    (New-Object System.Drawing.PointF ($cx, ($cx + $half))),
    (New-Object System.Drawing.PointF (($cx - $half), $cx))
)
$g.FillPolygon($brush, $points)
$brush.Dispose()
$g.Dispose()

# Save bitmap as PNG bytes
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Dispose()
$bmp.Dispose()

# Build ICO file (contains PNG data for 256x256)
$icoStream = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $icoStream
# ICO header
$w.Write([UInt16]0)       # reserved
$w.Write([UInt16]1)       # type: icon
$w.Write([UInt16]1)       # count: 1 image
# Directory entry (14 bytes)
$w.Write([byte]0)         # width 0 = 256
$w.Write([byte]0)         # height 0 = 256
$w.Write([byte]0)         # color palette count
$w.Write([byte]0)         # reserved
$w.Write([UInt16]1)       # color planes
$w.Write([UInt16]32)      # bits per pixel
$w.Write([UInt32]$pngBytes.Length)  # image data size
$w.Write([UInt32]22)      # offset to image data (6 header + 16 entry)
# Image data
$w.Write($pngBytes)
$w.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $icoStream.ToArray())
$w.Dispose()
$icoStream.Dispose()

Write-Host "Created icon: $icoPath"

# Flush Windows icon cache so the new icon shows up
$cacheDir = "$env:LOCALAPPDATA\Microsoft\Windows\Explorer"
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# --- Create desktop shortcut ---
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath "CIQ Dashboard.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSScriptRoot "start-app.bat"
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$icoPath, 0"
$shortcut.Description = "Start CIQ Dashboard"
$shortcut.Save()

Write-Host "Shortcut created at: $shortcutPath"
Write-Host "Done! You can now launch CIQ Dashboard from your desktop."
