import type { PdfWordGroup } from '@/lib/pdfWordEdit'
import { splitSentences } from '@/lib/pdfRegionContext'
import type { PdfTextStyle } from '@/lib/pdfTextStyle'

export type PdfSelBand = {
  left: number
  top: number
  width: number
  height: number
}

export type PdfWordSelResult = {
  words: PdfWordGroup[]
  startIndex: number
  endIndex: number
  text: string
  precedingContext: string
  followingContext: string
  /** Host-relative highlight bands (merged per line). */
  bands: PdfSelBand[]
  textStyle?: PdfTextStyle
}

const LINE_SLOP = 4

/** Reading order: top→bottom, then left→right. */
export function sortWordsReadingOrder(groups: PdfWordGroup[]): PdfWordGroup[] {
  return [...groups].sort((a, b) =>
    Math.abs(a.top - b.top) > LINE_SLOP ? a.top - b.top : a.left - b.left,
  )
}

/** Cluster sorted words into visual lines. */
export function clusterWordLines(sorted: PdfWordGroup[]): PdfWordGroup[][] {
  const lines: PdfWordGroup[][] = []
  for (const w of sorted) {
    const last = lines[lines.length - 1]
    if (
      last &&
      Math.abs(last[0]!.top - w.top) <=
        Math.max(LINE_SLOP, last[0]!.fontHeight * 0.35)
    ) {
      last.push(w)
    } else {
      lines.push([w])
    }
  }
  for (const line of lines) {
    line.sort((a, b) => a.left - b.left)
  }
  return lines
}

export function findWordIndexAt(
  sorted: PdfWordGroup[],
  x: number,
  y: number,
  opts?: { nearest?: boolean },
): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i]!
    const left = g.left
    const right = g.left + Math.max(g.width, 4)
    const top = g.top - 2
    const bottom = g.top + g.fontHeight + 4
    if (x >= left && x <= right && y >= top && y <= bottom) {
      const cx = (left + right) / 2
      const cy = (top + bottom) / 2
      const d = (x - cx) ** 2 + (y - cy) ** 2
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
  }
  if (best >= 0 || !opts?.nearest) return best

  // Nearest word while dragging past margins / between lines
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i]!
    const cx = g.left + Math.max(g.width, 4) / 2
    const cy = g.top + g.fontHeight / 2
    const d = (x - cx) ** 2 + (y - cy) ** 2 * 2.2
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Expand from a word to a visual “paragraph”: contiguous lines until a
 * larger-than-usual vertical gap (PDF paragraph break).
 */
export function paragraphRangeContaining(
  sorted: PdfWordGroup[],
  index: number,
): { start: number; end: number } {
  if (!sorted.length || index < 0 || index >= sorted.length) {
    return { start: Math.max(0, index), end: Math.max(0, index) }
  }
  const lines = clusterWordLines(sorted)
  let lineIdx = -1
  const target = sorted[index]!
  for (let li = 0; li < lines.length; li++) {
    if (lines[li]!.some((w) => w.id === target.id)) {
      lineIdx = li
      break
    }
  }
  if (lineIdx < 0) return { start: index, end: index }

  const gapBetween = (a: PdfWordGroup[], b: PdfWordGroup[]) => {
    const aBottom = Math.max(...a.map((w) => w.top + w.fontHeight))
    const bTop = Math.min(...b.map((w) => w.top))
    const typical = Math.max(
      LINE_SLOP * 2,
      (a[0]!.fontHeight + b[0]!.fontHeight) * 0.85,
    )
    return bTop - aBottom > typical
  }

  let lo = lineIdx
  let hi = lineIdx
  while (lo > 0 && !gapBetween(lines[lo - 1]!, lines[lo]!)) lo -= 1
  while (hi < lines.length - 1 && !gapBetween(lines[hi]!, lines[hi + 1]!)) {
    hi += 1
  }

  const ids = new Set<string>()
  for (let li = lo; li <= hi; li++) {
    for (const w of lines[li]!) ids.add(w.id)
  }
  let start = sorted.length
  let end = -1
  for (let i = 0; i < sorted.length; i++) {
    if (ids.has(sorted[i]!.id)) {
      start = Math.min(start, i)
      end = Math.max(end, i)
    }
  }
  if (start > end) return { start: index, end: index }
  return { start, end }
}

export function lineRangeContaining(
  sorted: PdfWordGroup[],
  index: number,
): { start: number; end: number } {
  if (index < 0 || index >= sorted.length) return { start: 0, end: -1 }
  const lines = clusterWordLines(sorted)
  const target = sorted[index]!
  for (const line of lines) {
    if (line.some((w) => w.id === target.id)) {
      const ids = new Set(line.map((w) => w.id))
      let start = sorted.length
      let end = -1
      for (let i = 0; i < sorted.length; i++) {
        if (ids.has(sorted[i]!.id)) {
          start = Math.min(start, i)
          end = Math.max(end, i)
        }
      }
      return { start, end }
    }
  }
  return { start: index, end: index }
}

/** Merge selected words into continuous per-line highlight bands. */
export function buildSelectionBands(words: PdfWordGroup[]): PdfSelBand[] {
  if (!words.length) return []
  const lines = clusterWordLines(sortWordsReadingOrder(words))
  return lines.map((line) => {
    const left = Math.min(...line.map((w) => w.left))
    const right = Math.max(...line.map((w) => w.left + Math.max(w.width, 4)))
    const top = Math.min(...line.map((w) => w.top))
    const bottom = Math.max(...line.map((w) => w.top + w.fontHeight))
    const padY = Math.max(2, (bottom - top) * 0.14)
    return {
      left: left - 2,
      top: top - padY,
      width: Math.max(2, right - left + 4),
      height: Math.max(2, bottom - top + padY * 2),
    }
  })
}

export function joinWordText(words: PdfWordGroup[]): string {
  if (!words.length) return ''
  const sorted = sortWordsReadingOrder(words)
  let out = ''
  let prev: PdfWordGroup | null = null
  for (const w of sorted) {
    const t = (w.currentText || w.str).replace(/\s+/g, ' ')
    if (!t) continue
    if (!prev) {
      out = t
    } else {
      const newLine = Math.abs(w.top - prev.top) > LINE_SLOP
      const gap = w.left - (prev.left + prev.width)
      if (newLine || (gap > 2.5 && !/\s$/.test(out) && !/^\s/.test(t))) {
        out += ' '
      }
      out += t
    }
    prev = w
  }
  return out.replace(/\s+/g, ' ').trim()
}

function styleFromWord(w: PdfWordGroup): PdfTextStyle {
  return {
    fontSizePx: w.fontHeight,
    fontFamily: w.fontName,
    fontWeight: '400',
    fontStyle: 'normal',
    color: '#1a1a1a',
    lineHeight: 1.35,
    letterSpacingPx: 0,
    textAlign: 'left',
  }
}

/**
 * Build a selection result from inclusive word indices in a sorted list.
 */
export function selectionFromIndices(
  sorted: PdfWordGroup[],
  startIndex: number,
  endIndex: number,
): PdfWordSelResult | null {
  if (!sorted.length) return null
  const a = Math.max(0, Math.min(startIndex, endIndex))
  const b = Math.min(sorted.length - 1, Math.max(startIndex, endIndex))
  if (a > b) return null
  const words = sorted.slice(a, b + 1)
  const text = joinWordText(words)
  if (text.length < 1) return null

  const before = joinWordText(sorted.slice(0, a))
  const after = joinWordText(sorted.slice(b + 1))
  const preSent = splitSentences(before)
  const postSent = splitSentences(after)

  return {
    words,
    startIndex: a,
    endIndex: b,
    text,
    precedingContext: preSent.slice(-10).join(' '),
    followingContext: postSent.slice(0, 10).join(' '),
    bands: buildSelectionBands(words),
    textStyle: styleFromWord(words[0]!),
  }
}

/** Client rect for toolbar — union of bands in viewport space. */
export function bandsClientRect(
  bands: PdfSelBand[],
  hostRect: DOMRect,
): DOMRect {
  if (!bands.length) {
    return new DOMRect(hostRect.left, hostRect.top, 1, 1)
  }
  const left = Math.min(...bands.map((b) => hostRect.left + b.left))
  const top = Math.min(...bands.map((b) => hostRect.top + b.top))
  const right = Math.max(...bands.map((b) => hostRect.left + b.left + b.width))
  const bottom = Math.max(
    ...bands.map((b) => hostRect.top + b.top + b.height),
  )
  return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top))
}
