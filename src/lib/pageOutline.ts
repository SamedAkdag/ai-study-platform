import type { PageText } from './slidingWindow'
import { cleanTopicLabel } from './titleQuality'

export type PageOutline = {
  pageNumber: number
  headings: string[]
  excerpt: string
}

/** Pull likely section headings — reject body sentences / money clauses. */
export function detectHeadings(text: string): string[] {
  const raw = text.replace(/\s+/g, ' ').trim()
  if (!raw) return []

  const candidates: string[] = []
  const patterns = [
    /(?:^|[.!?]\s+)(\d+(?:\.\d+){1,3}\s+[A-ZÇĞİÖŞÜ][^.]{3,50})/g,
    /(?:^|\s)((?:Chapter|Bölüm|Unit|Ünite|Section|Kısım|Konu)\s+[\dIVXLC]+[^.]{0,40})/gi,
  ]

  for (const re of patterns) {
    let m: RegExpExecArray | null
    const copy = new RegExp(re.source, re.flags)
    while ((m = copy.exec(raw)) !== null) {
      const cleaned = cleanTopicLabel(m[1] || '')
      if (cleaned) candidates.push(cleaned)
      if (candidates.length > 6) break
    }
  }

  return [...new Set(candidates)].slice(0, 4)
}

export function buildPageOutlines(pages: PageText[]): PageOutline[] {
  return pages.map((p) => ({
    pageNumber: p.pageNumber,
    headings: detectHeadings(p.text),
    excerpt: p.text.slice(0, 350),
  }))
}
