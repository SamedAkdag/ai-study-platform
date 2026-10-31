export type PdfSearchHit = {
  page: number
  /** Match snippet for UI */
  snippet: string
  /** 0-based index of match on that page's normalized text */
  indexOnPage: number
}

type PdfDocLike = {
  numPages: number
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{ items: unknown[] }>
  }>
}

function pagePlainText(items: unknown[]): string {
  let out = ''
  for (const raw of items) {
    const it = raw as { str?: string }
    const s = (it.str || '').trim()
    if (!s) continue
    if (out) out += ' '
    out += s
  }
  return out
}

/**
 * Scan PDF pages for `query` (case-insensitive). Caps total hits for UI.
 */
export async function searchPdfDocument(
  doc: PdfDocLike,
  query: string,
  opts?: { maxHits?: number; signal?: AbortSignal },
): Promise<PdfSearchHit[]> {
  const q = query.trim().toLocaleLowerCase('tr')
  if (q.length < 2) return []
  const maxHits = opts?.maxHits ?? 80
  const hits: PdfSearchHit[] = []
  const n = doc.numPages

  for (let page = 1; page <= n; page++) {
    if (opts?.signal?.aborted) break
    const pdfPage = await doc.getPage(page)
    const content = await pdfPage.getTextContent()
    const plain = pagePlainText(content.items)
    const lower = plain.toLocaleLowerCase('tr')
    let from = 0
    let onPage = 0
    while (hits.length < maxHits) {
      const idx = lower.indexOf(q, from)
      if (idx < 0) break
      const start = Math.max(0, idx - 28)
      const end = Math.min(plain.length, idx + q.length + 36)
      hits.push({
        page,
        indexOnPage: onPage,
        snippet: `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`,
      })
      onPage += 1
      from = idx + Math.max(1, q.length)
    }
    if (hits.length >= maxHits) break
  }
  return hits
}
