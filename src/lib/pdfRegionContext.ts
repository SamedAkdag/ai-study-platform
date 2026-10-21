import type { PdfRegion } from '@/lib/pdfRegion'

const DEFAULT_SENTENCES = 10

/** Split prose into sentences (TR-friendly: . ! ? …). */
export function splitSentences(text: string): string[] {
  const raw = text.replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const parts = raw
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
  return parts
}

/**
 * Reading-order text from PDF.js text layer spans, grouped by Y band.
 */
function linesFromTextLayer(
  textLayer: HTMLElement,
  host: HTMLElement,
): Array<{ text: string; topPct: number; bottomPct: number }> {
  const hostBox = host.getBoundingClientRect()
  const h = Math.max(1, hostBox.height)
  const spans = [
    ...textLayer.querySelectorAll('span, div'),
  ] as HTMLElement[]

  type Hit = { text: string; top: number; bottom: number; left: number }
  const hits: Hit[] = []
  for (const el of spans) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    const r = el.getBoundingClientRect()
    if (r.width < 0.5 && r.height < 0.5) continue
    hits.push({
      text: t,
      top: (r.top - hostBox.top) / h,
      bottom: (r.bottom - hostBox.top) / h,
      left: (r.left - hostBox.left) / Math.max(1, hostBox.width),
    })
  }
  if (!hits.length) return []

  hits.sort((a, b) => a.top - b.top || a.left - b.left)

  const lines: Array<{ text: string; topPct: number; bottomPct: number }> = []
  let cur: { parts: string[]; top: number; bottom: number; left: number } | null =
    null
  const lineSlop = 0.012 // ~1.2% of page ≈ same line

  for (const hit of hits) {
    if (!cur) {
      cur = {
        parts: [hit.text],
        top: hit.top,
        bottom: hit.bottom,
        left: hit.left,
      }
      continue
    }
    const sameLine = Math.abs(hit.top - cur.top) <= lineSlop
    if (sameLine) {
      cur.parts.push(hit.text)
      cur.bottom = Math.max(cur.bottom, hit.bottom)
    } else {
      lines.push({
        text: cur.parts.join(' ').replace(/\s+/g, ' ').trim(),
        topPct: cur.top,
        bottomPct: cur.bottom,
      })
      cur = {
        parts: [hit.text],
        top: hit.top,
        bottom: hit.bottom,
        left: hit.left,
      }
    }
  }
  if (cur) {
    lines.push({
      text: cur.parts.join(' ').replace(/\s+/g, ' ').trim(),
      topPct: cur.top,
      bottomPct: cur.bottom,
    })
  }
  return lines.filter((l) => l.text.length > 0)
}

/**
 * Collect up to `maxSentences` sentences above and below a page region
 * (chart/figure marquee) from the PDF text layer.
 */
export function contextAroundRegion(
  textLayer: HTMLElement | null,
  host: HTMLElement | null,
  region: PdfRegion,
  opts?: { maxSentences?: number },
): { precedingContext: string; followingContext: string } {
  const max = opts?.maxSentences ?? DEFAULT_SENTENCES
  if (!textLayer || !host) {
    return { precedingContext: '', followingContext: '' }
  }

  const lines = linesFromTextLayer(textLayer, host)
  if (!lines.length) {
    return { precedingContext: '', followingContext: '' }
  }

  const top = region.topPct
  const bottom = region.topPct + region.heightPct
  // Small pad so caption glued to the chart isn’t lost to “inside”
  const pad = 0.008

  const aboveLines = lines
    .filter((l) => l.bottomPct <= top + pad)
    .map((l) => l.text)
  const belowLines = lines
    .filter((l) => l.topPct >= bottom - pad)
    .map((l) => l.text)
  // Text overlapping the box (axis tick labels etc.) — useful caption crumbs
  const insideLines = lines
    .filter((l) => l.bottomPct > top + pad && l.topPct < bottom - pad)
    .map((l) => l.text)

  const aboveSentences = splitSentences(aboveLines.join(' '))
  const belowSentences = splitSentences(belowLines.join(' '))
  const insideBits = insideLines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)

  let preceding = aboveSentences.slice(-max).join(' ')
  if (insideBits && insideBits.length >= 12) {
    preceding = preceding
      ? `${preceding}\n[Şekil üzeri etiketler: ${insideBits}]`
      : `[Şekil üzeri etiketler: ${insideBits}]`
  }

  return {
    precedingContext: preceding,
    followingContext: belowSentences.slice(0, max).join(' '),
  }
}
