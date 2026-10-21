/** Page-relative box (0–1) for burning edits into the PDF. */
export type PdfRegion = {
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
}

export function clampRegion(r: PdfRegion): PdfRegion {
  const leftPct = Math.min(0.98, Math.max(0, r.leftPct))
  const topPct = Math.min(0.98, Math.max(0, r.topPct))
  const widthPct = Math.min(1 - leftPct, Math.max(0.02, r.widthPct))
  const heightPct = Math.min(1 - topPct, Math.max(0.008, r.heightPct))
  return { leftPct, topPct, widthPct, heightPct }
}

export function regionFromAnchor(
  anchor: { left: number; top: number; width: number; bottom: number },
  pageWidth: number,
  pageHeight: number,
): PdfRegion {
  const h = Math.max(8, anchor.bottom - anchor.top)
  return clampRegion({
    leftPct: anchor.left / pageWidth,
    topPct: anchor.top / pageHeight,
    widthPct: Math.max(anchor.width, 40) / pageWidth,
    heightPct: h / pageHeight,
  })
}

/** Client drag box → page-relative region (host = page element). */
export function regionFromClientRect(
  rect: { left: number; top: number; width: number; height: number },
  host: HTMLElement,
): PdfRegion {
  const box = host.getBoundingClientRect()
  const w = Math.max(1, box.width)
  const h = Math.max(1, box.height)
  return clampRegion({
    leftPct: (rect.left - box.left) / w,
    topPct: (rect.top - box.top) / h,
    widthPct: rect.width / w,
    heightPct: rect.height / h,
  })
}

/**
 * Crop a page canvas region to a data URL (JPEG by default — smaller for vision).
 * Downscales if the long edge exceeds `maxEdge`.
 */
export function cropCanvasRegionToDataUrl(
  canvas: HTMLCanvasElement,
  region: PdfRegion,
  opts?: { maxEdge?: number; mime?: string; quality?: number },
): string {
  // Keep payload small for Edge Function body limits (~few hundred KB).
  const maxEdge = opts?.maxEdge ?? 900
  const mime = opts?.mime ?? 'image/jpeg'
  let quality = opts?.quality ?? 0.72

  const sx = Math.max(0, Math.floor(region.leftPct * canvas.width))
  const sy = Math.max(0, Math.floor(region.topPct * canvas.height))
  const sw = Math.min(
    canvas.width - sx,
    Math.max(2, Math.ceil(region.widthPct * canvas.width)),
  )
  const sh = Math.min(
    canvas.height - sy,
    Math.max(2, Math.ceil(region.heightPct * canvas.height)),
  )

  let dw = sw
  let dh = sh
  const long = Math.max(sw, sh)
  if (long > maxEdge) {
    const s = maxEdge / long
    dw = Math.max(1, Math.round(sw * s))
    dh = Math.max(1, Math.round(sh * s))
  }

  const out = document.createElement('canvas')
  out.width = dw
  out.height = dh
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas yok')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, dw, dh)

  let dataUrl = out.toDataURL(mime, quality)
  // Soft cap ~350KB base64 — further compress if needed
  const maxChars = 350_000
  while (dataUrl.length > maxChars && quality > 0.45) {
    quality -= 0.08
    dataUrl = out.toDataURL(mime, quality)
  }
  if (dataUrl.length < 80 || !dataUrl.startsWith('data:image/')) {
    throw new Error('Grafik kırpılamadı')
  }
  return dataUrl
}
