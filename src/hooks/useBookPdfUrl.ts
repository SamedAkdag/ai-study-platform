import { useEffect, useState } from 'react'
import { resolveBookPdfSource } from '@/lib/bookPdf'
import {
  getPdfObjectUrl,
  recallPdf,
  rememberPdf,
} from '@/lib/pdfSession'
import { loadCachedPdf } from '@/lib/pdfCache'

/** Resolve a stable PDF URL for viewing (session → IDB → storage). */
export function useBookPdfUrl(
  bookId: string | undefined,
  fileUrl: string | null | undefined,
) {
  const [url, setUrl] = useState<string | null>(() =>
    bookId ? getPdfObjectUrl(bookId) : null,
  )
  const [loading, setLoading] = useState(!url)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bookId) {
      setUrl(null)
      setLoading(false)
      setError(null)
      return
    }

    // Zaten oturumda varsa anında
    const mem = getPdfObjectUrl(bookId)
    if (mem) {
      setUrl(mem)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const idb = await loadCachedPdf(bookId)
        if (cancelled) return
        if (idb) {
          rememberPdf(bookId, idb)
          const u = getPdfObjectUrl(bookId, idb)
          setUrl(u)
          return
        }

        const src = await resolveBookPdfSource(bookId, fileUrl)
        if (cancelled) return
        if (!src) {
          setUrl(null)
          setError('PDF bulunamadı')
          return
        }

        if (src.kind === 'blob') {
          // resolve yeni URL üretti — session’a al
          const blob = recallPdf(bookId) ?? (await loadCachedPdf(bookId))
          if (blob) {
            rememberPdf(bookId, blob)
            URL.revokeObjectURL(src.url)
            setUrl(getPdfObjectUrl(bookId, blob))
          } else {
            setUrl(src.url)
          }
        } else {
          setUrl(src.url)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF yüklenemedi')
          setUrl(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bookId, fileUrl])

  return { url, loading, error }
}
