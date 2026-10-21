import type { PdfAnnotation } from '@/lib/pdfAnnotations'
import type { PdfRegion } from '@/lib/pdfRegion'
import type { PdfTextStyle } from '@/lib/pdfTextStyle'
import { DEFAULT_PDF_TEXT_STYLE } from '@/lib/pdfTextStyle'

export type CanvasEdit = {
  kind: 'replace' | 'redact'
  region: PdfRegion
  body?: string
  textStyle?: PdfTextStyle | null
}

/**
 * True page paper color (Adobe Edit Text cover).
 * Uses the lightest pixels in/around the selection — not an average
 * (averages pick up ink and look like a dirty patch).
 */
export function samplePaperColor(
  ctx: CanvasRenderingContext2D,
  region: PdfRegion,
  width: number,
  height: number,
): string {
  const pad = 4
  const x = Math.max(0, Math.floor(region.leftPct * width) - pad)
  const y = Math.max(0, Math.floor(region.topPct * height) - pad)
  const w = Math.min(
    width - x,
    Math.max(4, Math.ceil(region.widthPct * width) + pad * 2),
  )
  const h = Math.min(
    height - y,
    Math.max(4, Math.ceil(region.heightPct * height) + pad * 2),
  )
  try {
    const { data } = ctx.getImageData(x, y, w, h)
    const samples: Array<{ L: number; r: number; g: number; b: number }> = []
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!
      if (a < 200) continue
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
      samples.push({ L, r, g, b })
    }
    if (samples.length < 4) return '#ffffff'
    samples.sort((a, b) => b.L - a.L)
    // Top ~18% brightest → paper (cream pages stay cream, not washed white)
    const n = Math.max(4, Math.floor(samples.length * 0.18))
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

/** Paint redact / replace onto the PDF page canvas (in-place, Adobe-like). */
export function paintEditsOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  edits: CanvasEdit[],
): void {
  for (const edit of edits) {
    const x = edit.region.leftPct * width
    const y = edit.region.topPct * height
    const w = Math.max(4, edit.region.widthPct * width)
    const h = Math.max(8, edit.region.heightPct * height)

    if (edit.kind === 'redact') {
      ctx.fillStyle = '#111111'
      ctx.fillRect(x, y, w, h)
      continue
    }

    const paper = samplePaperColor(ctx, edit.region, width, height)
    ctx.fillStyle = paper
    // Slight pad so glyphs are fully covered
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2)

    const style = edit.textStyle || DEFAULT_PDF_TEXT_STYLE
    // Prefer measured glyph box; fall back to sampled fontSize
    const fontSize = clamp(
      style.fontSizePx > 6 ? style.fontSizePx : h * 0.86,
      7,
      Math.max(8, h * 1.05),
    )
    const weight = style.fontWeight || '400'
    const italic = style.fontStyle === 'italic' ? 'italic' : 'normal'
    ctx.fillStyle = style.color || '#1a1a1a'
    ctx.font = `${italic} ${weight} ${fontSize}px ${style.fontFamily}`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign =
      style.textAlign === 'center'
        ? 'center'
        : style.textAlign === 'right'
          ? 'right'
          : 'left'

    const text = (edit.body || '').replace(/\s+/g, ' ').trim()
    if (!text) continue

    const padX = 1
    const maxW = w - padX * 2
    const lineH = fontSize * Math.max(1.05, style.lineHeight || 1.2)
    const ctxAny = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
    const prevLs = ctxAny.letterSpacing
    if (style.letterSpacingPx && 'letterSpacing' in ctx) {
      ctxAny.letterSpacing = `${style.letterSpacingPx}px`
    }
    const lines = wrapCanvasText(ctx, text, maxW)
    // alphabetic baseline ~ 0.8 em from top of box
    let ty = y + fontSize * 0.82
    const tx =
      style.textAlign === 'center'
        ? x + w / 2
        : style.textAlign === 'right'
          ? x + w - padX
          : x + padX

    for (const line of lines.slice(0, Math.max(1, Math.floor(h / lineH) + 1))) {
      ctx.fillText(line, tx, ty, maxW)
      ty += lineH
      if (ty > y + h - 1) break
    }
    if ('letterSpacing' in ctx) ctxAny.letterSpacing = prevLs ?? '0px'
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const lines: string[] = []
  let cur = words[0]!
  for (let i = 1; i < words.length; i++) {
    const trial = `${cur} ${words[i]}`
    if (ctx.measureText(trial).width <= maxWidth) {
      cur = trial
    } else {
      lines.push(cur)
      cur = words[i]!
    }
  }
  lines.push(cur)
  return lines
}

export function annotationToCanvasEdit(
  a: PdfAnnotation,
): CanvasEdit | null {
  if (!a.region) return null
  if (a.kind === 'redact') {
    return { kind: 'redact', region: a.region }
  }
  if (a.kind === 'replace' && a.body?.trim()) {
    return {
      kind: 'replace',
      region: a.region,
      body: a.body,
      textStyle: a.textStyle,
    }
  }
  return null
}
