/** Oturum içi PDF belleği — IndexedDB’den önce, anında açılış. */

const blobs = new Map<string, Blob>()
const objectUrls = new Map<string, string>()

function asPdfBlob(file: Blob): Blob {
  if (file.type === 'application/pdf') return file
  return new Blob([file], { type: 'application/pdf' })
}

export function rememberPdf(bookId: string, file: Blob): void {
  if (!bookId) return
  const blob = asPdfBlob(file)
  blobs.set(bookId, blob)
  const prev = objectUrls.get(bookId)
  if (prev) {
    URL.revokeObjectURL(prev)
    objectUrls.delete(bookId)
  }
}

export function recallPdf(bookId: string): Blob | null {
  return blobs.get(bookId) ?? null
}

/** Stabil object URL — file_url değişince revoke etme. */
export function getPdfObjectUrl(bookId: string, blob?: Blob | null): string | null {
  const existing = objectUrls.get(bookId)
  if (existing) return existing
  const raw = blob ?? blobs.get(bookId)
  if (!raw) return null
  const b = asPdfBlob(raw)
  const url = URL.createObjectURL(b)
  objectUrls.set(bookId, url)
  blobs.set(bookId, b)
  return url
}

export function forgetPdf(bookId: string): void {
  const url = objectUrls.get(bookId)
  if (url) URL.revokeObjectURL(url)
  objectUrls.delete(bookId)
  blobs.delete(bookId)
}
