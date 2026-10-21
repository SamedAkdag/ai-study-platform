import type { CSSProperties } from 'react'
import type { PdfRegion } from '@/lib/pdfRegion'

/**
 * Sample typography from a PDF text-layer selection so edits
 * match the surrounding book text (Adobe-like).
 *
 * Note: pdf.js text spans are often `color: transparent` — real ink
 * lives on the page canvas; use `refineStyleFromCanvas` after sampling.
 */

export type PdfTextStyle = {
  fontFamily: string
  /** CSS px — approximate on-screen size */
  fontSizePx: number
  fontWeight: string
  fontStyle: string
  color: string
  lineHeight: number
  letterSpacingPx: number
  textAlign: 'left' | 'right' | 'center' | 'justify'
}

const FALLBACK: PdfTextStyle = {
  fontFamily: 'Times New Roman, Times, Georgia, serif',
  fontSizePx: 14,
  fontWeight: '400',
  fontStyle: 'normal',
  color: '#1a1a1a',
  lineHeight: 1.35,
  letterSpacingPx: 0,
  textAlign: 'left',
}

function parseScaleX(el: HTMLElement): number {
  const t = el.style.transform || getComputedStyle(el).transform
  if (!t || t === 'none') return 1
  const m = t.match(/matrix\(([^)]+)\)/)
  if (m?.[1]) {
    const parts = m[1].split(',').map((x) => Number(x.trim()))
    if (parts.length >= 1 && Number.isFinite(parts[0]) && parts[0]! !== 0) {
      return Math.abs(parts[0]!)
    }
  }
  const m3 = t.match(/matrix3d\(([^)]+)\)/)
  if (m3?.[1]) {
    const parts = m3[1].split(',').map((x) => Number(x.trim()))
    if (parts.length >= 1 && Number.isFinite(parts[0]) && parts[0]! !== 0) {
      return Math.abs(parts[0]!)
    }
  }
  // scaleX(1.23)
  const sx = t.match(/scaleX\(([^)]+)\)/)
  if (sx?.[1]) {
    const n = Number(sx[1])
    if (Number.isFinite(n) && n !== 0) return Math.abs(n)
  }
  return 1
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function modeString(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    const k = v.trim() || ''
    if (!k) continue
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let best = ''
  let n = 0
  for (const [k, c] of counts) {
    if (c > n) {
      best = k
      n = c
    }
  }
  return best
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function normalizeAlign(raw: string): PdfTextStyle['textAlign'] {
  if (raw === 'right' || raw === 'end') return 'right'
  if (raw === 'center') return 'center'
  if (raw === 'justify') return 'justify'
  return 'left'
}

function isInvisibleColor(color: string): boolean {
  if (!color || color === 'transparent') return true
  if (/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(color)) return true
  const m = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  )
  if (m?.[4] !== undefined && Number(m[4]) < 0.08) return true
  return false
}

/** Map pdf.js / CSS font names to a stack the browser can actually paint. */
export function mapPdfFontFamily(raw: string): string {
  const s = (raw || '').toLowerCase()
  if (!s.trim()) return FALLBACK.fontFamily

  // pdf.js synthetic ids like g_d0_f1 — infer from keywords only
  const synthetic = /^g[_-]?d?\d|identity|unicode|embedded/i.test(s)

  if (/mono|courier|consolas|menlo|code|typewriter|ocr.?a/.test(s)) {
    return 'Courier New, Courier, ui-monospace, monospace'
  }
  if (
    /sans|arial|helvetica|calibri|verdana|tahoma|segoe|roboto|noto\s*sans|univers|futura|gill|frutiger|myriad|dejavu\s*sans/.test(
      s,
    )
  ) {
    return 'Arial, Helvetica, "Segoe UI", sans-serif'
  }
  if (
    /serif|times|georgia|garamond|cambria|palatino|minion|bookman|century|baskerville|roman|liberation\s*serif|dejavu\s*serif|noto\s*serif|eb\s*garamond/.test(
      s,
    )
  ) {
    return '"Times New Roman", Times, Georgia, serif'
  }
  if (/bold|black|heavy|demi/.test(s) && !synthetic) {
    // weight handled separately; family still serif-ish for books
  }
  if (!synthetic) {
    // Keep named font first so local installs can match
    const first = raw.split(',')[0]?.trim().replace(/^["']|["']$/g, '') || ''
    if (first.length > 1 && first.length < 48) {
      return `"${first}", "Times New Roman", Times, serif`
    }
  }
  return FALLBACK.fontFamily
}

function inferWeight(rawFamily: string, cssWeight: string): string {
  const s = rawFamily.toLowerCase()
  if (/black|heavy|extra.?bold/.test(s)) return '800'
  if (/bold|demi|semi.?bold|medium/.test(s)) {
    if (/semi|demi|medium/.test(s)) return '600'
    return '700'
  }
  if (/light|thin|hair/.test(s)) return '300'
  const n = Number(cssWeight)
  if (Number.isFinite(n)) return String(n)
  if (cssWeight === 'bold') return '700'
  return cssWeight || '400'
}

function inferStyle(rawFamily: string, cssStyle: string): string {
  if (/italic|oblique/i.test(rawFamily)) return 'italic'
  return cssStyle === 'italic' || cssStyle === 'oblique' ? 'italic' : 'normal'
}

/** Visual font size for pdf.js spans (geometry preferred). */
export function visualFontSizePx(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  const inline = Number.parseFloat(el.style.fontSize)
  const base =
    (Number.isFinite(inline) && inline > 0
      ? inline
      : Number.parseFloat(cs.fontSize)) || 12
  const scale = parseScaleX(el)
  const approx = base * (Math.abs(scale - 1) > 0.02 ? scale : 1)
  const box = el.getBoundingClientRect()
  const fromHeight = box.height
  const fromWidth =
    (el.textContent || '').trim().length > 0
      ? box.width / Math.max(1, (el.textContent || '').trim().length)
      : 0

  // Glyph box height is the best proxy for painted size
  if (fromHeight > 5 && fromHeight < 72) {
    // Slightly under full box — pdf.js boxes include leading
    return clamp(fromHeight * 0.88, 7, 48)
  }
  if (fromWidth > 4 && fromWidth < 40) {
    return clamp(fromWidth * 1.65, 7, 48)
  }
  return clamp(approx, 7, 48)
}

export function sampleTextStyleFromElements(
  els: HTMLElement[],
): PdfTextStyle | null {
  if (!els.length) return null

  const sizes: number[] = []
  const families: string[] = []
  const weights: string[] = []
  const styles: string[] = []
  const colors: string[] = []
  const lineHeights: number[] = []
  const letterSpacings: number[] = []
  const aligns: string[] = []
  const rawFamilies: string[] = []

  for (const el of els.slice(0, 48)) {
    const cs = getComputedStyle(el)
    const rawFam = el.style.fontFamily || cs.fontFamily || ''
    rawFamilies.push(rawFam)
    sizes.push(visualFontSizePx(el))
    families.push(mapPdfFontFamily(rawFam))
    weights.push(inferWeight(rawFam, cs.fontWeight || '400'))
    styles.push(inferStyle(rawFam, cs.fontStyle || 'normal'))
    const col = el.style.color || cs.color || ''
    if (!isInvisibleColor(col)) colors.push(rgbToHex(col) || col)
    const box = el.getBoundingClientRect()
    if (box.height > 4) {
      lineHeights.push(1.15)
    } else {
      lineHeights.push(1.35)
    }
    // Estimate tracking from span width vs char count
    const text = (el.textContent || '').replace(/\s/g, '')
    if (text.length >= 2 && box.width > 4) {
      const fs = visualFontSizePx(el)
      const expected = text.length * fs * 0.48
      const drift = (box.width - expected) / Math.max(1, text.length - 1)
      if (Number.isFinite(drift)) {
        letterSpacings.push(clamp(drift, -1.2, 3))
      }
    }
    aligns.push(cs.textAlign || 'left')
  }

  const fontSizePx = clamp(Math.round(median(sizes) * 10) / 10, 7, 48)
  let color = modeString(colors) || FALLBACK.color
  if (isInvisibleColor(color)) color = FALLBACK.color

  return {
    fontFamily: modeString(families) || mapPdfFontFamily(modeString(rawFamilies)),
    fontSizePx,
    fontWeight: modeString(weights) || FALLBACK.fontWeight,
    fontStyle: modeString(styles) || FALLBACK.fontStyle,
    color,
    lineHeight: clamp(median(lineHeights) || 1.25, 1.05, 1.8),
    letterSpacingPx: clamp(median(letterSpacings), -1, 2.5),
    textAlign: normalizeAlign(modeString(aligns) || 'left'),
  }
}

export function sampleTextStyleFromRange(range: Range): PdfTextStyle | null {
  const node = range.commonAncestorContainer
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement
  if (!el) return null
  return sampleTextStyleFromElements([el])
}

/**
 * Override size/color from the painted PDF canvas (true ink + glyph height).
 * Call this when opening replace / before burn-in.
 */
export function refineStyleFromCanvas(
  base: PdfTextStyle | null | undefined,
  ctx: CanvasRenderingContext2D,
  region: PdfRegion,
  pageWidth: number,
  pageHeight: number,
): PdfTextStyle {
  const style = { ...(base || FALLBACK) }
  const ink = sampleInkColor(ctx, region, pageWidth, pageHeight)
  if (ink) style.color = ink

  const h = region.heightPct * pageHeight
  if (h > 5 && h < 72) {
    // Match painted glyph box more tightly than CSS span heuristics
    style.fontSizePx = clamp(Math.round(h * 0.86 * 10) / 10, 7, 48)
  }
  return style
}

/** Darkest non-paper cluster in the region ≈ ink color. */
export function sampleInkColor(
  ctx: CanvasRenderingContext2D,
  region: PdfRegion,
  width: number,
  height: number,
): string | null {
  const x0 = Math.max(0, Math.floor(region.leftPct * width))
  const y0 = Math.max(0, Math.floor(region.topPct * height))
  const w = Math.min(width - x0, Math.max(2, Math.ceil(region.widthPct * width)))
  const h = Math.min(height - y0, Math.max(2, Math.ceil(region.heightPct * height)))
  try {
    const { data } = ctx.getImageData(x0, y0, w, h)
    // Paper ≈ lightest mode; ink = pixels clearly darker
    const luminances: number[] = []
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const a = data[i + 3]!
      if (a < 20) continue
      luminances.push(0.2126 * r + 0.7152 * g + 0.0722 * b)
    }
    if (luminances.length < 8) return null
    const paper = percentile(luminances, 0.85)
    const inkPixels: Array<[number, number, number]> = []
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const a = data[i + 3]!
      if (a < 20) continue
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
      // Must be distinctly darker than paper
      if (L < paper - 28 && L < 200) {
        inkPixels.push([r, g, b])
      }
    }
    if (inkPixels.length < 4) {
      return sampleDarkestAverage(data, 0.12)
    }
    let r = 0
    let g = 0
    let b = 0
    for (const p of inkPixels) {
      r += p[0]
      g += p[1]
      b += p[2]
    }
    const n = inkPixels.length
    return rgbHex(Math.round(r / n), Math.round(g / n), Math.round(b / n))
  } catch {
    return null
  }
}

function sampleDarkestAverage(data: Uint8ClampedArray, frac: number): string {
  const pixels: Array<{ L: number; r: number; g: number; b: number }> = []
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    if (data[i + 3]! < 20) continue
    pixels.push({
      L: 0.2126 * r + 0.7152 * g + 0.0722 * b,
      r,
      g,
      b,
    })
  }
  pixels.sort((a, b) => a.L - b.L)
  const n = Math.max(4, Math.floor(pixels.length * frac))
  const slice = pixels.slice(0, n)
  let r = 0
  let g = 0
  let b = 0
  for (const p of slice) {
    r += p.r
    g += p.g
    b += p.b
  }
  return rgbHex(Math.round(r / slice.length), Math.round(g / slice.length), Math.round(b / slice.length))
}

function percentile(nums: number[], p: number): number {
  const s = [...nums].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))
  return s[i]!
}

function rgbToHex(color: string): string | null {
  const m = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i,
  )
  if (!m) {
    if (/^#[0-9a-f]{3,8}$/i.test(color.trim())) return color.trim()
    return null
  }
  return rgbHex(
    Math.round(Number(m[1])),
    Math.round(Number(m[2])),
    Math.round(Number(m[3])),
  )
}

function rgbHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function isPdfTextStyle(v: unknown): v is PdfTextStyle {
  if (!v || typeof v !== 'object') return false
  const o = v as PdfTextStyle
  return typeof o.fontFamily === 'string' && typeof o.fontSizePx === 'number'
}

/** Inline style for matched UI (CSS variables). */
export function pdfTextStyleToReact(
  style: PdfTextStyle | null | undefined,
): CSSProperties | undefined {
  if (!style) return undefined
  return {
    ['--pdf-match-font' as string]: style.fontFamily,
    ['--pdf-match-size' as string]: `${style.fontSizePx}px`,
    ['--pdf-match-weight' as string]: style.fontWeight,
    ['--pdf-match-style' as string]: style.fontStyle,
    ['--pdf-match-color' as string]: style.color,
    ['--pdf-match-leading' as string]: String(style.lineHeight),
    ['--pdf-match-tracking' as string]: `${style.letterSpacingPx}px`,
    ['--pdf-match-align' as string]: style.textAlign,
  }
}

/** Direct CSS properties for the in-place editor field. */
export function pdfTextStyleToField(style: PdfTextStyle): CSSProperties {
  return {
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSizePx}px`,
    fontWeight: style.fontWeight as CSSProperties['fontWeight'],
    fontStyle: style.fontStyle,
    color: style.color,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacingPx}px`,
    textAlign: style.textAlign,
  }
}

export { FALLBACK as DEFAULT_PDF_TEXT_STYLE }
