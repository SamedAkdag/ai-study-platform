import { supabase } from './supabase'
import { cachePdfLocally, loadCachedPdf } from './pdfCache'
import { getPdfObjectUrl, recallPdf, rememberPdf } from './pdfSession'

const BUCKET = 'book-pdfs'

export function bookPdfStoragePath(bookId: string) {
  return `${bookId}/original.pdf`
}

async function uploadWithRetry(
  path: string,
  file: File | Blob,
  attempts = 3,
): Promise<{ error: Error | null }> {
  let last: Error | null = null
  for (let i = 0; i < attempts; i++) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: 'application/pdf',
      upsert: true,
    })
    if (!error) return { error: null }
    last = new Error(error.message)
    await new Promise((r) => window.setTimeout(r, 400 * (i + 1)))
  }
  return { error: last }
}

/** Upload original PDF to Storage + local cache; save path on books.file_url. */
export async function uploadBookPdf(bookId: string, file: File): Promise<string> {
  const path = bookPdfStoragePath(bookId)
  rememberPdf(bookId, file)
  const cached = await cachePdfLocally(bookId, file)
  rememberPdf(bookId, cached)

  const { error } = await uploadWithRetry(path, file, 3)

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

/** Best-effort re-upload when book is still local-only but PDF is cached. */
export async function tryPromoteLocalPdf(
  bookId: string,
  file: File | Blob,
): Promise<string | null> {
  const path = bookPdfStoragePath(bookId)
  const { error } = await uploadWithRetry(path, file, 2)
  if (error) return null
  await supabase.from('books').update({ file_url: path }).eq('id', bookId)
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
