/** Lightweight citation helpers for PDF selections (APA / IEEE / BibTeX). */

export type CitationStyle = 'apa' | 'ieee' | 'bibtex'

export type CiteSourceMeta = {
  title: string
  author?: string
  year?: string
}

export type CiteInput = CiteSourceMeta & {
  quote: string
  page: number
  style: CitationStyle
}

const STYLE_KEY = 'studium.citeStyle'
const META_PREFIX = 'studium.citeMeta.'

export const CITATION_STYLES: Array<{ id: CitationStyle; label: string }> = [
  { id: 'apa', label: 'APA' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'bibtex', label: 'BibTeX' },
]

export function loadCiteStyle(): CitationStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY)
    if (raw === 'apa' || raw === 'ieee' || raw === 'bibtex') return raw
  } catch {
    /* ignore */
  }
  return 'apa'
}

export function saveCiteStyle(style: CitationStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, style)
  } catch {
    /* ignore */
  }
}

export function loadCiteMeta(bookId: string): Partial<CiteSourceMeta> {
  try {
    const raw = localStorage.getItem(META_PREFIX + bookId)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<CiteSourceMeta>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveCiteMeta(
  bookId: string,
  meta: Partial<CiteSourceMeta>,
): void {
  try {
    localStorage.setItem(META_PREFIX + bookId, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
}

function clean(s: string | undefined, fallback: string): string {
  const t = (s || '').trim()
  return t || fallback
}

function bibtexKey(author: string, year: string, title: string): string {
  const a = author
    .split(/[,\s]+/)
    .find((p) => p.length > 1)
    ?.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, '')
    .slice(0, 12) || 'source'
  const y = year.replace(/\D/g, '').slice(0, 4) || 'nd'
  const t = title
    .replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ]+/g, '')
    .slice(0, 10)
    .toLowerCase() || 'doc'
  return `${a}${y}${t}`.replace(/\s+/g, '')
}

function escapeBib(s: string): string {
  return s.replace(/[{}\\]/g, '\\$&')
}

/** Formatted block ready to paste into a paper / reference manager. */
export function formatCitation(input: CiteInput): string {
  const title = clean(input.title, 'Adsız kaynak')
  const author = clean(input.author, title)
  const year = clean(input.year, 'n.d.')
  const page = input.page
  const quote = input.quote.replace(/\s+/g, ' ').trim()

  if (input.style === 'apa') {
    const inText =
      author === title
        ? `(${title}, ${year}, s. ${page})`
        : `(${author}, ${year}, s. ${page})`
    return `"${quote}" ${inText}\n\n${author}. (${year}). ${title}.`
  }

  if (input.style === 'ieee') {
    return `"${quote}" [1, p. ${page}]\n\n[1] ${author}, "${title}," ${year}.`
  }

  // bibtex
  const key = bibtexKey(author, year, title)
  return `@misc{${key},
  author = {${escapeBib(author)}},
  title  = {${escapeBib(title)}},
  year   = {${escapeBib(year)}},
  note   = {p. ${page}: "${escapeBib(quote.slice(0, 280))}${quote.length > 280 ? '…' : ''}"}
}`
}

export function citationStyleLabel(style: CitationStyle): string {
  if (style === 'apa') return 'APA'
  if (style === 'ieee') return 'IEEE'
  return 'BibTeX'
}
