import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib'
import type { PdfAnnotation } from '@/lib/pdfAnnotations'
import type { PdfRegion } from '@/lib/pdfRegion'
import { findQuoteAnchor } from '@/lib/pdfQuoteAnchor'

/** Load PDF bytes from a viewer URL (blob: or https). */
export async function fetchPdfBytes(src: string): Promise<Uint8Array> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`PDF okunamadı (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return doc.getPageCount()
}

function toZero(pages1: number[]): number[] {
  return [...new Set(pages1)]
    .filter((p) => Number.isFinite(p) && p >= 1)
    .map((p) => Math.floor(p) - 1)
    .sort((a, b) => a - b)
}

/** Keep only the given 1-based pages (extract / split). */
export async function extractPages(
  bytes: Uint8Array,
  pages1: number[],
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const indices = toZero(pages1).filter((i) => i < src.getPageCount())
  if (!indices.length) throw new Error('Geçerli sayfa seçilmedi')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, indices)
  for (const p of copied) out.addPage(p)
  return out.save()
}

/** Drop the given 1-based pages. */
export async function deletePages(
  bytes: Uint8Array,
  pages1: number[],
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const drop = new Set(toZero(pages1))
  const keep = src.getPageIndices().filter((i) => !drop.has(i))
  if (!keep.length) throw new Error('En az bir sayfa kalmalı')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, keep)
  for (const p of copied) out.addPage(p)
  return out.save()
}

/** Reorder to the given 1-based page sequence (must be a permutation). */
export async function reorderPages(
  bytes: Uint8Array,
  order1: number[],
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const n = src.getPageCount()
  const indices = order1.map((p) => p - 1)
  if (indices.length !== n || new Set(indices).size !== n) {
    throw new Error('Sayfa sırası eksik veya tekrarlı')
  }
  if (indices.some((i) => i < 0 || i >= n)) {
    throw new Error('Geçersiz sayfa numarası')
  }
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, indices)
  for (const p of copied) out.addPage(p)
  return out.save()
}

/** Rotate selected 1-based pages by 90 / 180 / 270 clockwise. */
export async function rotatePages(
  bytes: Uint8Array,
  pages1: number[],
  angle: 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const targets = new Set(toZero(pages1))
  if (!targets.size) throw new Error('Döndürülecek sayfa seç')
  const pages = doc.getPages()
  for (const i of targets) {
    const page = pages[i]
    if (!page) continue
    const cur = page.getRotation().angle
    page.setRotation(degrees((cur + angle) % 360))
  }
  return doc.save()
}

/** Append other PDF(s) after the current document. */
export async function mergePdfs(
  primary: Uint8Array,
  extras: Uint8Array[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of [primary, ...extras]) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const copied = await out.copyPages(src, src.getPageIndices())
    for (const p of copied) out.addPage(p)
  }
  return out.save()
}

/** Diagonal watermark on every page (shared-copy style). */
export async function watermarkPdf(
  bytes: Uint8Array,
  text: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const label = text.trim() || 'Studium'
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    const size = Math.min(48, Math.max(18, width / 12))
    page.drawText(label, {
      x: width * 0.18,
      y: height * 0.45,
      size,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.22,
      rotate: degrees(32),
    })
  }
  return doc.save()
}

export function pdfBytesToBlob(bytes: Uint8Array): Blob {
  // Copy into a fresh ArrayBuffer — avoids SharedArrayBuffer typing issues
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: 'application/pdf' })
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = pdfBytesToBlob(bytes)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

export type BurnableEdit = Pick<
  PdfAnnotation,
  'page' | 'kind' | 'quote' | 'body' | 'region' | 'textStyle'
> & {
  /** Paper fill behind replace text (CSS color). Default white. */
  paperColor?: string
  /**
   * PDF.js viewport scale used when fontSizePx was sampled.
   * Converts CSS px → PDF points: pts = px / scale.
   */
  viewerScale?: number
}

/**
 * Burn redact / replace edits into PDF page content (Adobe-like bake).
 * Whiteout uses sampled paper color; text size matches glyph box / scale.
 */
export async function burnTextEdits(
  bytes: Uint8Array,
  edits: BurnableEdit[],
): Promise<Uint8Array> {
  const actionable = edits.filter(
    (e) => e.kind === 'redact' || (e.kind === 'replace' && e.body?.trim()),
  )
  if (!actionable.length) throw new Error('Basılacak değiştir / sansür yok')

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const fontCache = new Map<
    StandardFonts,
    Awaited<ReturnType<typeof doc.embedFont>>
  >()
  async function fontOf(key: StandardFonts) {
    let f = fontCache.get(key)
    if (!f) {
      f = await doc.embedFont(key)
      fontCache.set(key, f)
    }
    return f
  }
  const pages = doc.getPages()

  for (const edit of actionable) {
    const page = pages[edit.page - 1]
    if (!page) continue
    const { width, height } = page.getSize()
    const region = edit.region ?? fallbackRegion(edit.quote)
    const x0 = region.leftPct * width
    const w0 = Math.max(4, region.widthPct * width)
    const h = Math.max(7, region.heightPct * height)
    // PDF y origin is bottom-left
    const y0 = height - region.topPct * height - h

    if (edit.kind === 'redact') {
      page.drawRectangle({
        x: x0 - 0.5,
        y: y0 - 0.5,
        width: w0 + 1,
        height: h + 1,
        color: rgb(0.05, 0.05, 0.05),
      })
      continue
    }

    const style = edit.textStyle
    const fontKey = pickStandardFont(
      style?.fontFamily,
      style?.fontStyle,
      style?.fontWeight,
    )
    const font = await fontOf(fontKey)
    const scale = edit.viewerScale && edit.viewerScale > 0.2 ? edit.viewerScale : 1
    // Adobe: match painted glyph height; CSS px ÷ viewer scale → PDF points
    const fromPx = style?.fontSizePx ? style.fontSizePx / scale : 0
    const fromBox = h * 0.82
    const size = clamp(
      fromPx > 5 ? fromPx : fromBox,
      6,
      Math.max(fromBox * 1.15, 28),
    )

    const text = (edit.body || '').replace(/\s+/g, ' ').trim()
    if (!text) continue

    const ink = cssToRgb(style?.color || '#1a1a1a')
    const paper = cssToRgb(edit.paperColor || '#ffffff')
    const textWidth = font.widthOfTextAtSize(text.slice(0, 800), size)
    // Grow cover if new text is longer (Adobe Add/Edit Text)
    const pad = 1.25
    const boxW = Math.max(w0, textWidth + pad * 2)
    const boxH = Math.max(h, size * 1.15)
    const boxX = x0 - pad
    const boxY = y0 - (boxH - h) * 0.15 - pad

    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxW + pad,
      height: boxH + pad * 2,
      color: rgb(paper.r, paper.g, paper.b),
    })

    // Baseline ≈ Adobe: sit on lower part of glyph box
    const baseline = boxY + Math.max(1.5, (boxH - size) * 0.22)
    page.drawText(text.slice(0, 800), {
      x: x0 + 0.5,
      y: baseline,
      size,
      font,
      color: rgb(ink.r, ink.g, ink.b),
      maxWidth: Math.max(16, boxW - 1),
      lineHeight: size * 1.15,
    })
  }

  return doc.save()
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Single replace/redact then return new PDF bytes. */
export async function applyTextEdit(
  bytes: Uint8Array,
  edit: BurnableEdit,
): Promise<Uint8Array> {
  return burnTextEdits(bytes, [edit])
}

/** StandardFonts are WinAnsi — map Turkish letters so drawText does not throw. */
export function toWinAnsiSafe(text: string): string {
  return text
    .replace(/ş/g, 's')
    .replace(/Ş/g, 'S')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'G')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'O')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'U')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?')
}

/**
 * Insert AI / note text in original PDF style just below a selection region
 * (vector drawText — does not rasterize the whole page).
 */
export async function insertStyledTextBlock(
  bytes: Uint8Array,
  input: {
    page: number
    body: string
    region?: import('@/lib/pdfRegion').PdfRegion
    textStyle?: BurnableEdit['textStyle']
    paperColor?: string
    viewerScale?: number
  },
): Promise<Uint8Array> {
  const raw = (input.body || '').replace(/\s+/g, ' ').trim()
  if (!raw) throw new Error('Eklenecek metin yok')
  const text = toWinAnsiSafe(raw)

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = doc.getPages()
  const pageIndex = Math.max(0, Math.min(pages.length - 1, input.page - 1))
  const page = pages[pageIndex]
  if (!page) throw new Error('Sayfa yok')
  const { width, height } = page.getSize()
  const region = input.region ?? {
    leftPct: 0.1,
    topPct: 0.4,
    widthPct: 0.8,
    heightPct: 0.03,
  }

  const style = input.textStyle
  const fontKey = pickStandardFont(
    style?.fontFamily,
    style?.fontStyle,
    style?.fontWeight,
  )
  const font = await doc.embedFont(fontKey)
  const scale = input.viewerScale && input.viewerScale > 0.2 ? input.viewerScale : 1.15
  const size = clamp(
    style?.fontSizePx ? style.fontSizePx / scale : region.heightPct * height * 0.85,
    7,
    16,
  )
  const ink = cssToRgb(style?.color || '#1a1a1a')
  const paper = cssToRgb(input.paperColor || '#ffffff')

  const x = Math.max(8, region.leftPct * width)
  const w = Math.max(80, Math.min(width - x - 8, region.widthPct * width * 1.05 || width * 0.75))
  // Place block just under the selection
  const gap = Math.max(4, size * 0.35)
  const topPct = Math.min(0.92, region.topPct + region.heightPct + gap / height)
  const maxLines = Math.min(24, Math.ceil(text.length / 70) + 2)
  const boxH = Math.min(height * 0.45, size * 1.25 * maxLines + 8)
  const yTop = height - topPct * height
  const y = Math.max(8, yTop - boxH)

  page.drawRectangle({
    x: x - 2,
    y: y - 2,
    width: w + 4,
    height: boxH + 4,
    color: rgb(paper.r, paper.g, paper.b),
    opacity: 0.97,
  })
  page.drawText(text.slice(0, 2500), {
    x: x + 2,
    y: y + boxH - size - 4,
    size,
    font,
    color: rgb(ink.r, ink.g, ink.b),
    maxWidth: Math.max(20, w - 4),
    lineHeight: size * 1.28,
  })

  return doc.save()
}

function pickStandardFont(
  family?: string,
  fontStyle?: string,
  fontWeight?: string,
): StandardFonts {
  const f = (family || '').toLowerCase()
  const italic =
    (fontStyle || '').includes('italic') || (fontStyle || '').includes('oblique')
  const bold = /^(bold|700|800|900|[6-9]00)/i.test((fontWeight || '').trim())
  const mono = /courier|mono|consolas|menlo|monaco/.test(f)
  const sans = /helvetica|arial|sans|verdana|tahoma|system|ui-sans/.test(f)
  if (mono) {
    if (bold && italic) return StandardFonts.CourierBoldOblique
    if (bold) return StandardFonts.CourierBold
    if (italic) return StandardFonts.CourierOblique
    return StandardFonts.Courier
  }
  if (sans) {
    if (bold && italic) return StandardFonts.HelveticaBoldOblique
    if (bold) return StandardFonts.HelveticaBold
    if (italic) return StandardFonts.HelveticaOblique
    return StandardFonts.Helvetica
  }
  if (bold && italic) return StandardFonts.TimesRomanBoldItalic
  if (bold) return StandardFonts.TimesRomanBold
  if (italic) return StandardFonts.TimesRomanItalic
  return StandardFonts.TimesRoman
}

function cssToRgb(color: string): { r: number; g: number; b: number } {
  const c = (color || '').trim()
  if (!c) return { r: 0.08, g: 0.08, b: 0.08 }
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex?.[1]) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    }
  }
  const rgbM = c.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i,
  )
  if (rgbM) {
    return {
      r: Math.min(1, Number(rgbM[1]) / 255),
      g: Math.min(1, Number(rgbM[2]) / 255),
      b: Math.min(1, Number(rgbM[3]) / 255),
    }
  }
  return { r: 0.08, g: 0.08, b: 0.08 }
}

function fallbackRegion(quote: string): PdfRegion {
  const len = Math.min(80, Math.max(12, quote.length))
  return {
    leftPct: 0.1,
    topPct: 0.35,
    widthPct: Math.min(0.8, 0.15 + len / 120),
    heightPct: 0.028,
  }
}

/** Optional: refine region from a live text layer (viewer). */
export function regionFromTextLayer(
  layer: HTMLElement,
  quote: string,
  pageWidth: number,
  pageHeight: number,
): PdfRegion | null {
  const anchor = findQuoteAnchor(layer, quote)
  if (!anchor || pageWidth < 1 || pageHeight < 1) return null
  return {
    leftPct: Math.max(0, anchor.left / pageWidth),
    topPct: Math.max(0, anchor.top / pageHeight),
    widthPct: Math.min(1, Math.max(0.04, anchor.width / pageWidth)),
    heightPct: Math.min(
      1,
      Math.max(0.01, (anchor.bottom - anchor.top) / pageHeight),
    ),
  }
}
