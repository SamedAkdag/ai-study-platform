import { PDFDocument } from 'pdf-lib'
import { pdfjsLib } from '@/lib/pdfjs'

/** One editable word/token from PDF.js textContent (demo-style). */
export type PdfWordGroup = {
  id: string
  /** Original string from PDF */
  str: string
  /** Current edited text */
  currentText: string
  /** Screen coords at display scale */
  left: number
  top: number
  width: number
  fontHeight: number
  /** PDF user-space (scale=1) */
  pdfX: number
  pdfY: number
  pdfWidth: number
  pdfFontSize: number
  fontName: string
}

type TextItem = {
  str: string
  transform: number[]
  width: number
  fontName?: string
}

/**
 * Group PDF.js text items into clickable words (same logic as the working HTML demo).
 */
export function buildWordGroups(
  textContent: { items: unknown[] },
  viewport: { transform: number[]; width: number; height: number },
  displayScale: number,
): PdfWordGroup[] {
  const Util = (
    pdfjsLib as unknown as {
      Util: {
        transform: (a: number[], b: number[]) => number[]
      }
    }
  ).Util

  const items: Array<{
    str: string
    left: number
    top: number
    width: number
    fontHeight: number
    pdfX: number
    pdfY: number
    pdfWidth: number
    pdfFontSize: number
    fontName: string
  }> = []

  for (const raw of textContent.items) {
    const item = raw as TextItem
    if (!item.str?.trim()) continue
    const tx = Util.transform(viewport.transform, item.transform)
    const fontHeight = Math.hypot(tx[2]!, tx[3]!)
    items.push({
      str: item.str,
      left: tx[4]!,
      top: tx[5]! - fontHeight,
      width: item.width * displayScale,
      fontHeight,
      pdfX: item.transform[4]!,
      pdfY: item.transform[5]!,
      pdfWidth: item.width,
      pdfFontSize: Math.hypot(item.transform[2]!, item.transform[3]!),
      fontName: item.fontName || 'Helvetica',
    })
  }

  items.sort((a, b) =>
    Math.abs(a.top - b.top) > 3 ? a.top - b.top : a.left - b.left,
  )

  const groups: typeof items = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    const gap = last ? item.left - (last.left + last.width) : -1
    if (
      last &&
      Math.abs(last.top - item.top) < 3 &&
      gap >= -1 &&
      gap < 2.5 &&
      last.fontName === item.fontName
    ) {
      last.str += item.str
      last.width = item.left + item.width - last.left
      last.pdfWidth = item.pdfX + item.pdfWidth - last.pdfX
    } else {
      groups.push({ ...item })
    }
  }

  return groups.map((g, i) => ({
    id: `g${i}`,
    str: g.str,
    currentText: g.str,
    left: g.left,
    top: g.top,
    width: g.width,
    fontHeight: g.fontHeight,
    pdfX: g.pdfX,
    pdfY: g.pdfY,
    pdfWidth: g.pdfWidth,
    pdfFontSize: g.pdfFontSize,
    fontName: g.fontName,
  }))
}

/** Sample paper under the word box (lightest pixels). */
export function samplePaperNearWord(
  ctx: CanvasRenderingContext2D,
  group: PdfWordGroup,
  scale: number,
): string {
  const x = group.pdfX * scale
  const fontSizePx = group.pdfFontSize * scale
  const baselineY = ctx.canvas.height - group.pdfY * scale
  const x0 = Math.max(0, Math.floor(x - 2))
  const y0 = Math.max(0, Math.floor(baselineY - fontSizePx * 1.05))
  const w = Math.min(
    ctx.canvas.width - x0,
    Math.max(4, Math.ceil(group.pdfWidth * scale + 8)),
  )
  const h = Math.min(
    ctx.canvas.height - y0,
    Math.max(4, Math.ceil(fontSizePx * 1.5)),
  )
  try {
    const { data } = ctx.getImageData(x0, y0, w, h)
    const samples: Array<{ L: number; r: number; g: number; b: number }> = []
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 200) continue
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      samples.push({ L: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b })
    }
    if (samples.length < 4) return '#ffffff'
    samples.sort((a, b) => b.L - a.L)
    const n = Math.max(4, Math.floor(samples.length * 0.2))
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < n; i++) {
      r += samples[i]!.r
      g += samples[i]!.g
      b += samples[i]!.b
    }
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
  } catch {
    return '#ffffff'
  }
}

/**
 * Paint one word edit onto a canvas (display or high-res export).
 * Same as the working HTML demo — whiteout + fillText in PDF glyph space.
 */
export function applyWordEditToCanvas(
  targetCtx: CanvasRenderingContext2D,
  group: PdfWordGroup,
  scale: number,
  opts?: { paperColor?: string; inkColor?: string },
): void {
  const x = group.pdfX * scale
  const baselineY = targetCtx.canvas.height - group.pdfY * scale
  const fontSizePx = group.pdfFontSize * scale
  const paper = opts?.paperColor || '#ffffff'
  const ink = opts?.inkColor || '#111111'

  targetCtx.fillStyle = paper
  targetCtx.fillRect(
    x - 2,
    baselineY - fontSizePx * 1.0,
    group.pdfWidth * scale + Math.max(6, (group.currentText.length - group.str.length) * fontSizePx * 0.45 + 6),
    fontSizePx * 1.4,
  )

  targetCtx.fillStyle = ink
  targetCtx.textBaseline = 'alphabetic'
  // pdf.js fontName is often synthetic (g_d0_f1) — fall back to common faces
  const face = mapFontFace(group.fontName)
  targetCtx.font = `${fontSizePx}px ${face}`
  targetCtx.fillText(group.currentText, x, baselineY)
}

function mapFontFace(fontName: string): string {
  const s = (fontName || '').toLowerCase()
  if (/mono|courier|code/.test(s)) return '"Courier New", Courier, monospace'
  if (/sans|arial|helvetica|calibri|verdana/.test(s))
    return 'Arial, Helvetica, sans-serif'
  if (/times|serif|roman|georgia|garamond/.test(s))
    return '"Times New Roman", Times, serif'
  return `"${fontName}", "Times New Roman", Times, Helvetica, Arial, sans-serif`
}

/**
 * Re-render page at high scale, paint edits, replace that page with embedded PNG.
 * Visually matches Adobe-style edit; edited page becomes a raster (tradeoff).
 */
export async function bakeWordEditsIntoPage(
  pdfBytes: Uint8Array,
  pageNumber1: number,
  edits: PdfWordGroup[],
  exportScale = 3,
): Promise<Uint8Array> {
  const changed = edits.filter((g) => g.currentText !== g.str)
  if (!changed.length) return pdfBytes

  await import('@/lib/pdfjs').then((m) => m.ensurePdfWorker())
  const copy = new Uint8Array(pdfBytes.byteLength)
  copy.set(pdfBytes)
  const pdf = await pdfjsLib.getDocument({ data: copy }).promise
  const page = await pdf.getPage(pageNumber1)
  const viewport = page.getViewport({ scale: exportScale })
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = viewport.width
  exportCanvas.height = viewport.height
  const expCtx = exportCanvas.getContext('2d')
  if (!expCtx) throw new Error('Canvas yok')
  await page.render({ canvasContext: expCtx, viewport }).promise

  for (const edit of changed) {
    applyWordEditToCanvas(expCtx, edit, exportScale)
  }

  const blob = await new Promise<Blob | null>((r) =>
    exportCanvas.toBlob(r, 'image/png'),
  )
  if (!blob) throw new Error('PNG oluşturulamadı')
  const pngBytes = new Uint8Array(await blob.arrayBuffer())

  const origViewport = page.getViewport({ scale: 1 })
  await pdf.destroy()

  return replacePageWithPng(
    pdfBytes,
    pageNumber1,
    pngBytes,
    origViewport.width,
    origViewport.height,
  )
}

async function replacePageWithPng(
  bytes: Uint8Array,
  pageNumber1: number,
  pngBytes: Uint8Array,
  pageWidth: number,
  pageHeight: number,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const png = await out.embedPng(pngBytes)
  const n = src.getPageCount()
  const idx = pageNumber1 - 1
  for (let i = 0; i < n; i++) {
    if (i === idx) {
      const page = out.addPage([pageWidth, pageHeight])
      page.drawImage(png, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      })
    } else {
      const [copied] = await out.copyPages(src, [i])
      out.addPage(copied)
    }
  }
  return out.save()
}

/** Find word group whose box intersects a screen-space rect (selection). */
export function findWordGroupAt(
  groups: PdfWordGroup[],
  clientX: number,
  clientY: number,
  hostRect: DOMRect,
): PdfWordGroup | null {
  const x = clientX - hostRect.left
  const y = clientY - hostRect.top
  let best: PdfWordGroup | null = null
  let bestArea = Infinity
  for (const g of groups) {
    if (
      x >= g.left &&
      x <= g.left + Math.max(g.width, 4) &&
      y >= g.top - 2 &&
      y <= g.top + g.fontHeight + 4
    ) {
      const area = Math.max(g.width, 4) * (g.fontHeight + 4)
      if (area < bestArea) {
        bestArea = area
        best = g
      }
    }
  }
  return best
}

/** Words overlapping a client-space selection rect (host-relative via hostRect). */
export function groupsIntersectingClientRect(
  groups: PdfWordGroup[],
  sel: DOMRect,
  hostRect: DOMRect,
): PdfWordGroup[] {
  return groups.filter((g) => {
    const gl = hostRect.left + g.left
    const gt = hostRect.top + g.top
    const gr = gl + Math.max(g.width, 4)
    const gb = gt + g.fontHeight + 4
    return !(sel.right < gl || sel.left > gr || sel.bottom < gt || sel.top > gb)
  })
}

/**
 * Merge selected words into one editable span.
 * Selected sentence text is transferred into the span for the input field.
 */
export function buildEditSpanFromSelection(
  groups: PdfWordGroup[],
  selectedText: string,
): PdfWordGroup | null {
  if (!groups.length) return null
  const sorted = [...groups].sort((a, b) =>
    Math.abs(a.top - b.top) > 3 ? a.top - b.top : a.left - b.left,
  )
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const left = Math.min(...sorted.map((g) => g.left))
  const top = Math.min(...sorted.map((g) => g.top))
  const right = Math.max(...sorted.map((g) => g.left + Math.max(g.width, 4)))
  const bottom = Math.max(...sorted.map((g) => g.top + g.fontHeight))
  const pdfX = Math.min(...sorted.map((g) => g.pdfX))
  const pdfRight = Math.max(...sorted.map((g) => g.pdfX + g.pdfWidth))
  // Prefer lowest baseline (same line) — median-ish pdfY
  const pdfYs = sorted.map((g) => g.pdfY).sort((a, b) => a - b)
  const pdfY = pdfYs[Math.floor(pdfYs.length / 2)]!
  const sizes = sorted.map((g) => g.pdfFontSize).sort((a, b) => a - b)
  const pdfFontSize = sizes[Math.floor(sizes.length / 2)]!
  const joined = sorted.map((g) => g.currentText).join(' ').replace(/\s+/g, ' ').trim()
  const transferred = selectedText.replace(/\s+/g, ' ').trim() || joined

  return {
    id: `span:${first.id}:${last.id}`,
    str: joined || transferred,
    currentText: transferred,
    left,
    top,
    width: Math.max(4, right - left),
    fontHeight: Math.max(first.fontHeight, bottom - top),
    pdfX,
    pdfY,
    pdfWidth: Math.max(4, pdfRight - pdfX),
    pdfFontSize,
    fontName: first.fontName,
  }
}
