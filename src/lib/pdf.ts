import * as pdfjsLib from 'pdfjs-dist'
import type { PageText } from './slidingWindow'
import { sanitizeForPostgres } from './sanitize'
import { ensurePdfWorker } from './pdfjs'

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

export async function openPdfFromSource(
  source: File | Blob | ArrayBuffer | Uint8Array,
): Promise<pdfjsLib.PDFDocumentProxy> {
  await ensurePdfWorker()
  let data: Uint8Array
  if (source instanceof Uint8Array) {
    data = source.slice(0)
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source.slice(0))
  } else {
    const buf = await source.arrayBuffer()
    data = new Uint8Array(buf.slice(0))
  }
  return pdfjsLib.getDocument({ data }).promise
}

type TextContentItem = {
  str?: string
  transform?: number[]
  width?: number
  hasEOL?: boolean
}

type LaidOutToken = {
  text: string
  x: number
  y: number
  w: number
}

type ColumnBound = { x0: number; x1: number }

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Aynı satırdaki tipik kelime aralığı — sütun gutter bundan çok daha geniş olmalı. */
function medianInterWordGap(bands: LaidOutToken[][]): number {
  const gaps: number[] = []
  for (const band of bands) {
    const ordered = [...band].sort((a, b) => a.x - b.x)
    for (let i = 1; i < ordered.length; i += 1) {
      const g = ordered[i]!.x - (ordered[i - 1]!.x + ordered[i - 1]!.w)
      if (g > 0 && g < 40) gaps.push(g)
    }
  }
  return Math.max(3, median(gaps) || 4)
}

/**
 * Sayfa genelinde 2 sütun sınırları — kelime aralığına değil gutter’a bak.
 * Kelime kelime “sütun” üretmez.
 */
function inferStableColumnBounds(
  bands: LaidOutToken[][],
): ColumnBound[] | null {
  if (bands.length < 3) return null
  const wordGap = medianInterWordGap(bands)
  const gutterMin = Math.max(wordGap * 4.5, 28)

  type Split = { left: LaidOutToken[]; right: LaidOutToken[]; gap: number }
  const splits: Split[] = []

  for (const band of bands) {
    if (band.length < 2) continue
    const ordered = [...band].sort((a, b) => a.x - b.x)
    let bestGap = -1
    let after = -1
    for (let i = 1; i < ordered.length; i += 1) {
      const g = ordered[i]!.x - (ordered[i - 1]!.x + ordered[i - 1]!.w)
      if (g > bestGap) {
        bestGap = g
        after = i - 1
      }
    }
    if (after < 0 || bestGap < gutterMin) continue
    const left = ordered.slice(0, after + 1)
    const right = ordered.slice(after + 1)
    if (!left.length || !right.length) continue
    // Her yarıda en az bir “parça”; tek harf sütun sayma
    const leftChars = left.reduce((s, t) => s + t.text.length, 0)
    const rightChars = right.reduce((s, t) => s + t.text.length, 0)
    if (leftChars < 4 || rightChars < 4) continue
    splits.push({ left, right, gap: bestGap })
  }

  // Sayfanın anlamlı kısmı iki parçalı olmalı
  if (splits.length < Math.max(3, Math.floor(bands.length * 0.35))) {
    return null
  }

  const leftTokens = splits.flatMap((s) => s.left)
  const rightTokens = splits.flatMap((s) => s.right)
  return [
    {
      x0: Math.min(...leftTokens.map((t) => t.x)),
      x1: Math.max(...leftTokens.map((t) => t.x + t.w)),
    },
    {
      x0: Math.min(...rightTokens.map((t) => t.x)),
      x1: Math.max(...rightTokens.map((t) => t.x + t.w)),
    },
  ]
}

function assignBandToColumns(
  tokens: LaidOutToken[],
  bounds: ColumnBound[],
): string[] {
  const buckets: LaidOutToken[][] = bounds.map(() => [])
  const margin = 14

  for (const sp of tokens) {
    const cx = sp.x + sp.w / 2
    let best = 0
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < bounds.length; i += 1) {
      const { x0, x1 } = bounds[i]!
      const mid = (x0 + x1) / 2
      const d = Math.abs(cx - mid)
      if (x0 - margin <= cx && cx <= x1 + margin && d < bestD) {
        bestD = d
        best = i
      } else if (d < bestD) {
        bestD = d
        best = i
      }
    }
    buckets[best]!.push(sp)
  }

  return buckets.map((bucket) => {
    if (!bucket.length) return ''
    bucket.sort((a, b) => a.x - b.x)
    return bucket
      .map((t) => t.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  })
}

function lineLooksLikeTitle(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 55 || t.length < 3) return false
  if (/[.!?…]$/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  // Tek kelime başlık nadiren geçerli — kelime kelime bölünmeyi engelle
  if (words.length < 2 || words.length > 8) return false
  return true
}

function mdColumnSections(header: string[], bodies: string[]): string {
  const parts: string[] = []
  for (let i = 0; i < header.length; i += 1) {
    let title = (header[i] || '').replace(/\s+/g, ' ').trim()
    const body = (bodies[i] || '').replace(/\s+/g, ' ').trim()
    if (!title && !body) continue
    // Başlık gibi değilse gövdeye kat
    if (title && !lineLooksLikeTitle(title)) {
      const merged = body ? `${title} ${body}` : title
      parts.push(merged)
      continue
    }
    if (title) parts.push(`### ${title}`)
    if (body) parts.push(body)
  }
  return parts.join('\n\n')
}

function bandToProseLine(tokens: LaidOutToken[]): string {
  return [...tokens]
    .sort((a, b) => a.x - b.x)
    .map((t) => t.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function itemsToTokens(items: object[]): LaidOutToken[] {
  const tokens: LaidOutToken[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue
    const item = raw as TextContentItem
    const str = (item.str ?? '').replace(/\s+/g, ' ')
    if (!str.trim()) continue
    const x = item.transform?.[4]
    const y = item.transform?.[5]
    if (typeof x !== 'number' || typeof y !== 'number') continue
    tokens.push({
      text: str,
      x,
      y,
      w:
        typeof item.width === 'number'
          ? item.width
          : Math.max(8, str.length * 4.5),
    })
  }
  return tokens
}

function tokensToYBands(tokens: LaidOutToken[]): LaidOutToken[][] {
  if (!tokens.length) return []
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)
  const bands: LaidOutToken[][] = []
  let cur: LaidOutToken[] = [sorted[0]!]
  let curY = sorted[0]!.y
  for (let i = 1; i < sorted.length; i += 1) {
    const t = sorted[i]!
    if (Math.abs(t.y - curY) <= 5.5) {
      cur.push(t)
      curY = cur.reduce((s, x) => s + x.y, 0) / cur.length
    } else {
      bands.push(cur)
      cur = [t]
      curY = t.y
    }
  }
  bands.push(cur)
  return bands
}

function columnRegionBBox(
  bands: LaidOutToken[][],
  bounds: ColumnBound[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  const tokens = bands.flat()
  if (!tokens.length) return null
  const mid = (bounds[0]!.x1 + bounds[1]!.x0) / 2
  // Sütun bölgesine düşen satırlar
  const inRegion: LaidOutToken[] = []
  for (const band of bands) {
    const cells = assignBandToColumns(band, bounds)
    if (cells.filter((c) => c.length >= 3).length >= 2) {
      inRegion.push(...band)
      continue
    }
    // Tek sütun satırı da bölge içindeyse dahil (sütun yüksekliği)
    const cx = band.reduce((s, t) => s + t.x + t.w / 2, 0) / band.length
    if (Math.abs(cx - mid) < Math.abs(bounds[1]!.x1 - bounds[0]!.x0)) {
      inRegion.push(...band)
    }
  }
  if (inRegion.length < 4) return null
  return {
    x0: Math.min(...inRegion.map((t) => t.x)),
    y0: Math.min(...inRegion.map((t) => t.y)),
    x1: Math.max(...inRegion.map((t) => t.x + t.w)),
    y1: Math.max(...inRegion.map((t) => t.y + 12)),
  }
}

/**
 * Metin katmanını satır/paragraf koruyarak çıkar.
 * Kararlı 2 sütun varsa: her sütun ### + gövde (alt alta).
 * Kelime aralıklarından sahte sütun ÜRETMEZ.
 */
export function textContentToString(items: object[]): string {
  const tokens = itemsToTokens(items)
  if (!tokens.length) return ''

  const bands = tokensToYBands(tokens)
  const colBounds = inferStableColumnBounds(bands)

  if (colBounds) {
    const colLines: string[][] = colBounds.map(() => [])
    for (const band of bands) {
      const cells = assignBandToColumns(band, colBounds)
      cells.forEach((text, ci) => {
        if (text) colLines[ci]!.push(text)
      })
    }

    const headers: string[] = []
    const bodies: string[] = []
    for (let ci = 0; ci < colBounds.length; ci += 1) {
      const lines = colLines[ci] || []
      if (!lines.length) {
        headers.push('')
        bodies.push('')
        continue
      }
      const first = lines[0]!
      if (lineLooksLikeTitle(first) && lines.length >= 2) {
        headers.push(first)
        bodies.push(lines.slice(1).join(' '))
      } else {
        headers.push('')
        bodies.push(lines.join(' '))
      }
    }
    const md = mdColumnSections(headers, bodies)
    if (md.trim()) return md
  }

  // Tek sütun / sütun yok — klasik satır birleştirme
  const lines: string[] = []
  let prevY: number | null = null
  for (const band of bands) {
    const y = band.reduce((s, t) => s + t.y, 0) / band.length
    const prose = bandToProseLine(band)
    if (!prose) continue
    if (prevY !== null && Math.abs(prevY - y) > 14) lines.push('')
    lines.push(prose)
    prevY = y
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Onarılan markdown kelime-kelime başlık çöplüğü mü? */
export function isFragmentedColumnMarkdown(md: string): boolean {
  const headings = md.match(/^#{1,6}\s+.+$/gm) || []
  if (headings.length < 3) return false
  const short = headings.filter((h) => {
    const t = h.replace(/^#{1,6}\s+/, '').trim()
    return t.split(/\s+/).length <= 1 || t.length <= 4
  })
  return short.length >= 3 || (headings.length >= 5 && short.length >= 2)
}

/**
 * İki sütunlu sayfa onarımı:
 * 1) Öncelik: yalnızca sütun bölgesinin PNG kliipi (profesyonel, bozulmaz)
 * 2) Yedek: kararlı sütun metni (alt alta ###)
 */
export async function extractPageColumnMarkdown(
  src: string,
  pageNumber: number,
): Promise<string | null> {
  if (!src || pageNumber < 1) return null
  await ensurePdfWorker()
  const res = await fetch(src)
  if (!res.ok) return null
  const data = new Uint8Array(await res.arrayBuffer())
  const doc = await pdfjsLib.getDocument({ data }).promise
  try {
    if (pageNumber > doc.numPages) return null
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const tokens = itemsToTokens(content.items as object[])
    const bands = tokensToYBands(tokens)
    const bounds = inferStableColumnBounds(bands)

    // --- Bölge görseli (tercih) ---
    if (bounds) {
      const bbox = columnRegionBBox(bands, bounds)
      if (bbox) {
        const clipMd = await clipPageRegionToMarkdown(page, bbox)
        if (clipMd) return clipMd
      }
    }

    // --- Metin yedek ---
    const md = textContentToString(content.items as object[])
    if (!md.trim()) return null
    if (isFragmentedColumnMarkdown(md)) return null
    return sanitizeForPostgres(md)
  } catch {
    return null
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

async function clipPageRegionToMarkdown(
  page: pdfjsLib.PDFPageProxy,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): Promise<string | null> {
  try {
    const base = page.getViewport({ scale: 1 })
    // pdf.js y: origin alt-sol; text transform y yukarı
    // getTextContent transform[5] viewport PDF user space (origin bottom-left)
    const pad = 8
    const x0 = Math.max(0, bbox.x0 - pad)
    const x1 = Math.min(base.width, bbox.x1 + pad)
    // text y is baseline from bottom; approximate height with +font
    const pdfY0 = Math.max(0, bbox.y0 - pad)
    const pdfY1 = Math.min(base.height, bbox.y1 + pad)
    const clipW = x1 - x0
    const clipH = pdfY1 - pdfY0
    if (clipW < 40 || clipH < 40) return null

    const scale = 1.6
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(clipW * scale)
    canvas.height = Math.ceil(clipH * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // PDF user space: y up. Canvas: y down. Render full page then crop.
    const full = document.createElement('canvas')
    full.width = Math.ceil(viewport.width)
    full.height = Math.ceil(viewport.height)
    const fctx = full.getContext('2d')
    if (!fctx) return null
    await page.render({ canvasContext: fctx, viewport }).promise

    // Convert PDF y (bottom origin) to canvas y (top origin)
    const canvasY = viewport.height - pdfY1 * scale
    ctx.drawImage(
      full,
      x0 * scale,
      canvasY,
      clipW * scale,
      clipH * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    let dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > 900_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.86)
    }
    if (dataUrl.length < 80) return null
    return `![İki sütun](${dataUrl})`
  } catch {
    return null
  }
}

/** Tek sayfa metin katmanı. */
export async function extractOnePageText(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  return sanitizeForPostgres(textContentToString(content.items as object[]))
}

/** Sadece sayfa sayısı — açılışı bloklamamalı. */
export async function probePdfMeta(
  file: File | Blob,
  fallbackTitle?: string,
): Promise<{ title: string; totalPages: number }> {
  const pdf = await openPdfFromSource(file)
  try {
    const name =
      file instanceof File
        ? file.name.replace(/\.pdf$/i, '')
        : fallbackTitle || 'Untitled book'
    return {
      title: sanitizeForPostgres(
        (fallbackTitle && fallbackTitle.trim()) || name || 'Untitled book',
      ),
      totalPages: pdf.numPages,
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }
}

/**
 * Tüm sayfaları sırayla çıkar (eski API — progressive tercih et).
 */
export async function extractPdfText(
  file: File | Blob | ArrayBuffer | Uint8Array,
  opts?: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    titleHint?: string
  },
): Promise<{
  title: string
  totalPages: number
  pages: PageText[]
}> {
  const pdf = await openPdfFromSource(file)
  const pages: PageText[] = []
  const total = pdf.numPages

  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      if (opts?.signal?.aborted) break
      const text = await extractOnePageText(pdf, pageNumber)
      pages.push({ pageNumber, text })
      opts?.onProgress?.(pageNumber, total)
      if (pageNumber % 2 === 0) await yieldToMain()
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }

  const title = sanitizeForPostgres(
    opts?.titleHint ||
      (file instanceof File
        ? file.name.replace(/\.pdf$/i, '')
        : 'Untitled book') ||
      'Untitled book',
  )

  return { title, totalPages: total, pages }
}
