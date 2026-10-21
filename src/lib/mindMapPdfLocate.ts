import type { PageSource } from '@/types/database'

export type MindMapPdfHit = {
  page: number
  score: number
  reason: 'page_field' | 'topic' | 'excerpt' | 'page_text'
}

function tokensFrom(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

function scoreText(hay: string, tokens: string[]): number {
  const lower = hay.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (!lower.includes(t)) continue
    score += t.length >= 6 ? 3 : 2
  }
  return score
}

/**
 * Find the best PDF page for a mind-map node label.
 * Prefer explicit page, then page_sources topics/excerpts, then page_text blocks.
 */
export function locateMindMapInPdf(input: {
  label: string
  /** Explicit page from AI mind_map branch when present */
  page?: number | null
  pageSources?: PageSource[] | null
  pageText?: string | null
  /** Chapter range clamp */
  startPage?: number | null
  endPage?: number | null
}): MindMapPdfHit | null {
  const label = input.label.replace(/\s+/g, ' ').trim()
  if (!label) return null

  const start = input.startPage ?? 1
  const end = input.endPage ?? 9999
  const clamp = (p: number) => Math.min(end, Math.max(start, p))

  if (
    typeof input.page === 'number' &&
    Number.isFinite(input.page) &&
    input.page >= 1
  ) {
    return {
      page: clamp(Math.round(input.page)),
      score: 100,
      reason: 'page_field',
    }
  }

  const tokens = tokensFrom(label)
  if (!tokens.length) return null

  let best: MindMapPdfHit | null = null
  const consider = (page: number, score: number, reason: MindMapPdfHit['reason']) => {
    if (score <= 0) return
    const hit = { page: clamp(page), score, reason }
    if (!best || hit.score > best.score) best = hit
  }

  for (const src of input.pageSources ?? []) {
    if (!src || typeof src.page !== 'number') continue
    let s = 0
    for (const topic of src.topics ?? []) {
      s += scoreText(String(topic), tokens) * 2
    }
    s += scoreText(String(src.excerpt || ''), tokens)
    if (s > 0) consider(src.page, s, s >= 4 ? 'topic' : 'excerpt')
  }

  const pageText = String(input.pageText || '')
  if (pageText) {
    const parts = pageText.split(/---\s*Page\s+(\d+)\s*---/i)
    for (let i = 1; i < parts.length; i += 2) {
      const page = Number(parts[i])
      const body = parts[i + 1] || ''
      if (!Number.isFinite(page)) continue
      const s = scoreText(body.slice(0, 2500), tokens)
      if (s > 0) consider(page, s, 'page_text')
    }
  }

  return best && best.score >= 2 ? best : null
}
