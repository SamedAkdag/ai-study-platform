import { supabase } from './supabase'
import { cachePdfLocally, loadCachedPdf } from './pdfCache'
import { getPdfObjectUrl, recallPdf, rememberPdf } from './pdfSession'

const BUCKET = 'book-pdfs'

export function bookPdfStoragePath(bookId: string) {
  return `${bookId}/original.pdf`
}

/** Upload original PDF to Storage + local cache; save path on books.file_url. */
export async function uploadBookPdf(bookId: string, file: File): Promise<string> {
  const path = bookPdfStoragePath(bookId)
  rememberPdf(bookId, file)
  const cached = await cachePdfLocally(bookId, file)
  rememberPdf(bookId, cached)

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: 'application/pdf',
    upsert: true,
  })

  if (error) {
    console.warn('PDF storage upload failed; using local cache only', error)
    await supabase.from('books').update({ file_url: `local:${bookId}` }).eq('id', bookId)
    return `local:${bookId}`
  }

  const { error: updErr } = await supabase
    .from('books')
    .update({ file_url: path })
    .eq('id', bookId)
  if (updErr) console.warn('file_url update failed', updErr)

  return path
}

/**
 * Resolve a viewable PDF source: session → IndexedDB → signed Storage URL.
 */
export async function resolveBookPdfSource(
  bookId: string,
  fileUrl: string | null | undefined,
): Promise<{ url: string; kind: 'blob' | 'remote' } | null> {
  const mem = recallPdf(bookId)
  if (mem) {
    const url = getPdfObjectUrl(bookId, mem)
    if (url) return { url, kind: 'blob' }
  }

  const cached = await loadCachedPdf(bookId)
  if (cached) {
    rememberPdf(bookId, cached)
    const url = getPdfObjectUrl(bookId, cached)
    if (url) return { url, kind: 'blob' }
  }

  if (!fileUrl || fileUrl.startsWith('local:')) return null

  const path = fileUrl.includes('/') ? fileUrl : bookPdfStoragePath(bookId)
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 6)

  if (error || !data?.signedUrl) {
    console.warn('signed PDF URL failed', error)
    return null
  }
  return { url: data.signedUrl, kind: 'remote' }
}
