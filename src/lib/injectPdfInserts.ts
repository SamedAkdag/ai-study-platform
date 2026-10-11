import {
  annotationAiLabel,
  annotationKindLabel,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import { normQuote } from '@/lib/pdfQuoteAnchor'
import { isFlowInsert } from '@/lib/pdfInserts'

/**
 * Inject saved PDF inserts into Studium markdown after the matching quote,
 * so study mode also reads as an expanded book.
 */
export function injectPdfInsertsIntoMarkdown(
  markdown: string,
  annotations: PdfAnnotation[],
  page: number,
): string {
  const inserts = annotations
    .filter((a) => a.page === page && isFlowInsert(a) && a.body?.trim())
    .sort((a, b) => (b.quote?.length || 0) - (a.quote?.length || 0))

  if (!inserts.length) return markdown

  let out = markdown
  const used = new Set<string>()

  for (const a of inserts) {
    const quote = (a.quote || '').trim()
    if (quote.length < 8) continue
    const stub = quote.slice(0, Math.min(72, quote.length))
    const idx = indexOfLoose(out, stub)
    if (idx < 0) continue

    // Place after the paragraph that contains the quote
    let end = out.indexOf('\n\n', idx)
    if (end < 0) end = out.length
    const mark = `<!-- insert:${a.id} -->`
    if (out.includes(mark) || used.has(a.id)) continue
    used.add(a.id)

    const label =
      a.kind === 'ai'
        ? annotationAiLabel(a.aiMode)
        : annotationKindLabel(a.kind)
    const qLine = a.question ? `\n>\n> _Soru: ${escapeMd(a.question)}_` : ''
    const body = escapeBlockquote(a.body || '')
    const block = `\n\n${mark}\n\n> **${label} · kitaba ek**${qLine}\n>\n${body}\n`

    out = out.slice(0, end) + block + out.slice(end)
  }

  return out
}

function indexOfLoose(hay: string, needle: string): number {
  const direct = hay.indexOf(needle)
  if (direct >= 0) return direct
  const n = normQuote(needle)
  const words = n.split(' ').filter((w) => w.length > 2).slice(0, 8)
  if (words.length < 2) return -1
  const normHay = normQuote(hay)
  const at = normHay.indexOf(words.join(' '))
  if (at < 0) return -1
  // Map roughly back — prefer original stub search on raw with first word
  return hay.toLocaleLowerCase('tr').indexOf(words[0])
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function escapeBlockquote(md: string): string {
  return md
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
}
