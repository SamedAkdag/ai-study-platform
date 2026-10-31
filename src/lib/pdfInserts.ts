import type { PdfAnnotation } from '@/lib/pdfAnnotations'
import { findQuoteAnchor } from '@/lib/pdfQuoteAnchor'

export type PageInsert = {
  id: string
  /** Y cut on the full page (bottom of quote), px */
  y: number
  annotation?: PdfAnnotation
  draft?: boolean
}

export type PageSegment =
  | { type: 'band'; key: string; srcTop: number; height: number }
  | { type: 'insert'; key: string; insert: PageInsert }

/** Short notes / bookmarks sit in the side margin — never cover book text. */
export const SHORT_NOTE_CHARS = 140

export function isMarginNote(a: PdfAnnotation): boolean {
  if (a.kind === 'bookmark') return true
  if (a.kind !== 'note') return false
  const body = (a.body || '').trim()
  if (!body) return true
  return body.length <= SHORT_NOTE_CHARS
}

/**
 * In-flow inserts open vertical space (AI + long notes).
 * Short notes / bookmarks use the margin rail instead — never overlay body text.
 */
export function isFlowInsert(a: PdfAnnotation): boolean {
  if (
    a.kind === 'highlight' ||
    a.kind === 'underline' ||
    a.kind === 'strike' ||
    a.kind === 'redact' ||
    a.kind === 'replace' ||
    a.kind === 'omit' ||
    a.kind === 'bookmark'
  ) {
    return false
  }
  if (isMarginNote(a)) return false
  return !!(a.body && a.body.trim())
}

export function resolveInsertY(
  a: PdfAnnotation,
  pageHeight: number,
  textLayer: HTMLElement | null,
): number {
  if (typeof a.anchorTopPct === 'number') {
    return Math.min(pageHeight - 1, Math.max(1, a.anchorTopPct * pageHeight))
  }
  if (textLayer) {
    const anchor = findQuoteAnchor(textLayer, a.quote)
    if (anchor) return Math.min(pageHeight - 1, Math.max(1, anchor.bottom))
  }
  return pageHeight * 0.55
}

/**
 * Split a page of `pageHeight` into alternating PDF bands and insert slots,
 * ordered top→bottom. Inserts at nearly the same Y are stacked in one cut.
 */
export function buildPageSegments(
  pageHeight: number,
  inserts: PageInsert[],
): PageSegment[] {
  if (pageHeight <= 0) return []
  if (!inserts.length) {
    return [{ type: 'band', key: 'band-full', srcTop: 0, height: pageHeight }]
  }

  const sorted = [...inserts].sort((a, b) => a.y - b.y)
  const cuts: Array<{ y: number; items: PageInsert[] }> = []
  const mergeSlop = 14

  for (const item of sorted) {
    const y = Math.min(pageHeight - 1, Math.max(1, item.y))
    const last = cuts[cuts.length - 1]
    if (last && Math.abs(last.y - y) <= mergeSlop) {
      last.items.push(item)
    } else {
      cuts.push({ y, items: [item] })
    }
  }

  const segments: PageSegment[] = []
  let cursor = 0

  cuts.forEach((cut, i) => {
    const bandH = Math.max(0, cut.y - cursor)
    if (bandH > 0.5) {
      segments.push({
        type: 'band',
        key: `band-${i}-${cursor}`,
        srcTop: cursor,
        height: bandH,
      })
    }
    for (const item of cut.items) {
      segments.push({
        type: 'insert',
        key: `insert-${item.id}`,
        insert: item,
      })
    }
    cursor = cut.y
  })

  const tail = pageHeight - cursor
  if (tail > 0.5) {
    segments.push({
      type: 'band',
      key: `band-tail-${cursor}`,
      srcTop: cursor,
      height: tail,
    })
  }

  return segments
}
