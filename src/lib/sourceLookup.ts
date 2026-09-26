export type PageSource = {
  page: number
  topics: string[]
  excerpt: string
}

export type SourceHit = {
  page: number
  excerpt: string
  score: number
}

/** Find PDF passages related to a selected explanation sentence. */
export function findRelatedPassages(
  pageSources: PageSource[],
  selected: string,
  limit = 3,
): SourceHit[] {
  const needle = selected.replace(/\s+/g, ' ').trim()
  if (needle.length < 4 || pageSources.length === 0) return []

  const tokens = tokenize(needle)
  if (tokens.length === 0) return []

  const hits: SourceHit[] = []

  for (const src of pageSources) {
    const text = src.excerpt || ''
    if (!text.trim()) continue

    // Direct substring / soft includes
    const lower = text.toLowerCase()
    const n = needle.toLowerCase()
    let score = 0
    if (lower.includes(n.slice(0, Math.min(40, n.length)))) score += 8

    for (const tok of tokens) {
      if (tok.length < 4) continue
      if (lower.includes(tok)) score += 1
    }

    if (score <= 0) continue

    // Prefer a window around the best token match
    const excerpt = bestWindow(text, tokens) || text.slice(0, 420)
    hits.push({ page: src.page, excerpt, score })
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

function tokenize(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .split(/[^a-zçğıöşü0-9]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 4),
    ),
  ].slice(0, 12)
}

function bestWindow(text: string, tokens: string[]): string {
  const lower = text.toLowerCase()
  let bestAt = -1
  for (const tok of tokens) {
    const idx = lower.indexOf(tok)
    if (idx >= 0) {
      bestAt = idx
      break
    }
  }
  if (bestAt < 0) return text.slice(0, 420)
  const start = Math.max(0, bestAt - 80)
  const end = Math.min(text.length, bestAt + 340)
  return text.slice(start, end).trim()
}

export function parsePageTextToSources(pageText: string): PageSource[] {
  const parts = pageText.split(/---\s*Page\s+(\d+)\s*---/i)
  const pages: PageSource[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const page = Number(parts[i])
    const excerpt = (parts[i + 1] || '').trim()
    if (Number.isFinite(page)) {
      pages.push({ page, topics: [], excerpt: excerpt.slice(0, 1200) })
    }
  }
  return pages
}
