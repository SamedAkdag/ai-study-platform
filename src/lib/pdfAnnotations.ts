import type { PdfTextStyle } from '@/lib/pdfTextStyle'
import type { PdfRegion } from '@/lib/pdfRegion'

export type PdfAnnotationKind =
  | 'note'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'replace'
  | 'redact'
  | 'omit'
  | 'extract'
  | 'cite'
  | 'bookmark'
  | 'ai'

export type PdfAiMode = 'ask' | 'summarize' | 'explain' | 'anlatim'

export type PdfAnnotation = {
  id: string
  bookId: string
  page: number
  kind: PdfAnnotationKind
  quote: string
  /** User note / citation / AI answer body / replacement text */
  body?: string
  /** apa | ieee | bibtex when kind === 'cite' */
  citeStyle?: string
  /** When kind === 'ai' */
  aiMode?: PdfAiMode
  /** User question for ask mode */
  question?: string
  /** Vertical anchor as fraction of page height (0–1), under the quote */
  anchorTopPct?: number
  anchorLeftPct?: number
  /** Sampled from selection so insert body matches PDF typography */
  textStyle?: PdfTextStyle
  /** Page box for burn-in (replace / redact) */
  region?: PdfRegion
  createdAt: string
}

function key(bookId: string) {
  return `studium.pdfNotes.${bookId}`
}

export function loadPdfAnnotations(bookId: string): PdfAnnotation[] {
  try {
    const raw = localStorage.getItem(key(bookId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as PdfAnnotation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function savePdfAnnotations(
  bookId: string,
  items: PdfAnnotation[],
): void {
  try {
    localStorage.setItem(key(bookId), JSON.stringify(items.slice(0, 400)))
  } catch {
    /* quota */
  }
}

export function addPdfAnnotation(
  bookId: string,
  input: Omit<PdfAnnotation, 'id' | 'bookId' | 'createdAt'>,
): PdfAnnotation {
  const item: PdfAnnotation = {
    ...input,
    id: crypto.randomUUID(),
    bookId,
    createdAt: new Date().toISOString(),
  }
  const next = [item, ...loadPdfAnnotations(bookId)]
  savePdfAnnotations(bookId, next)
  void import('./pdfAnnotationsSync').then((m) => m.pushPdfAnnotation(item))
  return item
}

export function updatePdfAnnotation(
  bookId: string,
  id: string,
  patch: Partial<
    Pick<
      PdfAnnotation,
      | 'body'
      | 'kind'
      | 'citeStyle'
      | 'question'
      | 'aiMode'
      | 'anchorTopPct'
      | 'anchorLeftPct'
      | 'textStyle'
      | 'region'
    >
  >,
): PdfAnnotation[] {
  const next = loadPdfAnnotations(bookId).map((a) =>
    a.id === id ? { ...a, ...patch } : a,
  )
  savePdfAnnotations(bookId, next)
  const updated = next.find((a) => a.id === id)
  if (updated) {
    void import('./pdfAnnotationsSync').then((m) =>
      m.pushPdfAnnotation(updated),
    )
  }
  return next
}

export function removePdfAnnotation(
  bookId: string,
  id: string,
): PdfAnnotation[] {
  const next = loadPdfAnnotations(bookId).filter((a) => a.id !== id)
  savePdfAnnotations(bookId, next)
  void import('./pdfAnnotationsSync').then((m) =>
    m.removePdfAnnotationRemote(bookId, id),
  )
  return next
}

export function annotationKindLabel(kind: PdfAnnotationKind): string {
  if (kind === 'note') return 'Benim notum'
  if (kind === 'highlight') return 'Vurgu'
  if (kind === 'underline') return 'Altı çizili'
  if (kind === 'strike') return 'Üstü çizili'
  if (kind === 'replace') return 'Değiştirildi'
  if (kind === 'redact') return 'Sansür'
  if (kind === 'omit') return 'Çıkarıldı'
  if (kind === 'extract') return 'Alıntı'
  if (kind === 'cite') return 'Cite'
  if (kind === 'ai') return 'AI notu'
  return 'Yer imi'
}

export function annotationAiLabel(mode?: PdfAiMode): string {
  if (mode === 'summarize') return 'Özet'
  if (mode === 'explain') return 'Açıklama'
  if (mode === 'anlatim') return 'Anlatım’dan'
  return 'AI yanıtı'
}
