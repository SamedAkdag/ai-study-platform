/** Normalize quote text for fuzzy match against pdf.js spans. */
export function normQuote(s: string): string {
  return s
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr')
}

export type QuoteAnchor = {
  /** px from top of page host */
  top: number
  left: number
  width: number
  bottom: number
}

/**
 * Locate a quote in a pdf.js text layer and return a viewport-relative
 * box (relative to the layer/page host) under which to park an inline card.
 */
export function findQuoteAnchor(
  layer: HTMLElement,
  quote: string,
): QuoteAnchor | null {
  const q = normQuote(quote)
  if (q.length < 3) return null

  const spans = [...layer.querySelectorAll('span')] as HTMLElement[]
  const norms = spans.map((s) => normQuote(s.textContent || ''))

  let full = ''
  const ranges: Array<{ start: number; end: number; i: number }> = []
  for (let i = 0; i < norms.length; i++) {
    const t = norms[i]
    if (!t) {
      ranges.push({ start: full.length, end: full.length, i })
      continue
    }
    if (full.length) full += ' '
    const start = full.length
    full += t
    ranges.push({ start, end: full.length, i })
  }

  let idx = full.indexOf(q)
  let matchLen = q.length
  if (idx < 0) {
    const stub = q.slice(0, Math.min(48, q.length))
    idx = full.indexOf(stub)
    matchLen = stub.length
  }
  if (idx < 0) return null

  const endAt = idx + matchLen
  const hitSpans = ranges
    .filter((r) => r.end > idx && r.start < endAt)
    .map((r) => spans[r.i])
    .filter(Boolean)

  if (!hitSpans.length) return null

  const host = layer.offsetParent as HTMLElement | null
  const hostBox = (host || layer).getBoundingClientRect()
  const boxes = hitSpans.map((s) => s.getBoundingClientRect())
  const left = Math.min(...boxes.map((b) => b.left)) - hostBox.left
  const top = Math.min(...boxes.map((b) => b.top)) - hostBox.top
  const right = Math.max(...boxes.map((b) => b.right)) - hostBox.left
  const bottom = Math.max(...boxes.map((b) => b.bottom)) - hostBox.top

  return {
    top,
    left: Math.max(0, left),
    width: Math.max(120, right - left),
    bottom,
  }
}
