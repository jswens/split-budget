Add-Type -AssemblyName System.Drawing
foreach ($iconSize in @(192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($iconSize, $iconSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#254f46'))
    $scale = $iconSize / 512
    $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#eff7f1'), 26 * $scale)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(128 * $scale, 258 * $scale),
        [System.Drawing.PointF]::new(256 * $scale, 148 * $scale),
        [System.Drawing.PointF]::new(384 * $scale, 258 * $scale),
        [System.Drawing.PointF]::new(384 * $scale, 384 * $scale),
        [System.Drawing.PointF]::new(128 * $scale, 384 * $scale)
    )
    $graphics.DrawPolygon($pen, $points)
    $graphics.DrawLine($pen, 256 * $scale, 275 * $scale, 256 * $scale, 384 * $scale)
    $bitmap.Save((Join-Path $PSScriptRoot "../public/icon-$iconSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
