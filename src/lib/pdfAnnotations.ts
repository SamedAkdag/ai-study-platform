export type PdfAnnotationKind =
  | 'note'
  | 'highlight'
  | 'omit'
  | 'extract'
  | 'cite'
  | 'bookmark'

export type PdfAnnotation = {
  id: string
  bookId: string
  page: number
  kind: PdfAnnotationKind
  quote: string
  /** User's own explanation / "benim notum" / formatted citation */
  body?: string
  /** apa | ieee | bibtex when kind === 'cite' */
  citeStyle?: string
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
  return item
}

export function updatePdfAnnotation(
  bookId: string,
  id: string,
  patch: Partial<Pick<PdfAnnotation, 'body' | 'kind' | 'citeStyle'>>,
): PdfAnnotation[] {
  const next = loadPdfAnnotations(bookId).map((a) =>
    a.id === id ? { ...a, ...patch } : a,
  )
  savePdfAnnotations(bookId, next)
  return next
}

export function removePdfAnnotation(
  bookId: string,
  id: string,
): PdfAnnotation[] {
  const next = loadPdfAnnotations(bookId).filter((a) => a.id !== id)
  savePdfAnnotations(bookId, next)
  return next
}

export function annotationKindLabel(kind: PdfAnnotationKind): string {
  if (kind === 'note') return 'Benim notum'
  if (kind === 'highlight') return 'Vurgu'
  if (kind === 'omit') return 'Çıkarıldı'
  if (kind === 'extract') return 'Alıntı'
  if (kind === 'cite') return 'Cite'
  return 'Yer imi'
}
