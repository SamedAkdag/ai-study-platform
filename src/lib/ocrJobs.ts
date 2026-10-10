import type { PageText } from './slidingWindow'
import { mergeOcrPages, pageNeedsOcr, pdfNeedsOcr } from './pageTextQuality'
import { cachePageTexts, loadCachedPdf } from './pdfCache'
import { ocrWeakPagesInBrowser } from './ocrBrowser'
import { pingOcrService, ocrPdfViaService } from './ocrRemote'

export type OcrJobStatus = {
  bookId: string
  phase: 'idle' | 'running' | 'done' | 'error'
  done: number
  total: number
  message: string
  engine?: string
}

type Listener = (s: OcrJobStatus) => void

const listeners = new Set<Listener>()
const jobs = new Map<string, AbortController>()
const lastStatus = new Map<string, OcrJobStatus>()

export function subscribeOcrJob(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getOcrJobStatus(bookId: string): OcrJobStatus | null {
  return lastStatus.get(bookId) ?? null
}

function emit(status: OcrJobStatus) {
  lastStatus.set(status.bookId, status)
  for (const fn of listeners) {
    try {
      fn(status)
    } catch {
      /* ignore */
    }
  }
  try {
    window.dispatchEvent(
      new CustomEvent('studium-ocr', { detail: status }),
    )
  } catch {
    /* ignore */
  }
}

function ocrDoneKey(bookId: string) {
  return `studium.ocrReady.${bookId}`
}

export function markOcrReady(bookId: string) {
  try {
    localStorage.setItem(ocrDoneKey(bookId), '1')
  } catch {
    /* ignore */
  }
}

export function isOcrMarkedReady(bookId: string): boolean {
  try {
    return localStorage.getItem(ocrDoneKey(bookId)) === '1'
  } catch {
    return false
  }
}

/**
 * PDF yüklendikten sonra arka planda otomatik OCR.
 * Kullanıcı okumaya devam eder; sayfalar hazır oldukça cache güncellenir.
 */
export function startBackgroundOcr(input: {
  bookId: string
  pages: PageText[]
  /** Opsiyonel: elimizde File/Blob varsa servis yolu da dener */
  file?: Blob | null
}): void {
  const { bookId, pages } = input
  if (!bookId || !pages.length) return
  if (isOcrMarkedReady(bookId)) return
  if (jobs.has(bookId)) return

  // Metin katmanı zaten doluysa OCR’a hiç girme (temiz text PDF)
  if (!pdfNeedsOcr(pages)) {
    markOcrReady(bookId)
    emit({
      bookId,
      phase: 'done',
      done: pages.length,
      total: pages.length,
      message: 'Metin hazır — OCR gerekmedi',
      engine: 'pdfjs',
    })
    return
  }

  const weakTotal = pages.filter((p) => pageNeedsOcr(p.text)).length

  const ac = new AbortController()
  jobs.set(bookId, ac)

  emit({
    bookId,
    phase: 'running',
    done: 0,
    total: Math.min(Math.max(weakTotal, 1), 80),
    message: 'Taranmış sayfalar metne dönüştürülüyor…',
  })

  void (async () => {
    try {
      // 1) Opsiyonel hızlı yol: yerel Docling/Tesseract servisi
      const health = await pingOcrService()
      let file = input.file ?? null
      if (!file) {
        file = await loadCachedPdf(bookId)
      }

      if (health.ok && file && !ac.signal.aborted) {
        emit({
          bookId,
          phase: 'running',
          done: 0,
          total: 1,
          message: health.docling
            ? 'OCR (Docling)…'
            : 'OCR (Tesseract servisi)…',
          engine: health.docling ? 'docling' : 'tesseract',
        })
        try {
          const remote = await ocrPdfViaService(file)
          if (!ac.signal.aborted) {
            const merged = mergeOcrPages(pages, remote.pages)
            await cachePageTexts(bookId, merged)
            markOcrReady(bookId)
            emit({
              bookId,
              phase: 'done',
              done: merged.length,
              total: merged.length,
              message: 'PDF hazır',
              engine: remote.engine,
            })
            return
          }
        } catch (err) {
          console.warn('remote OCR failed, falling back to browser', err)
        }
      }

      // 2) Tarayıcı OCR (varsayılan — kurulum gerektirmez)
      const blob = file ?? (await loadCachedPdf(bookId))
      if (!blob) throw new Error('PDF bulunamadı')
      const buf = await blob.arrayBuffer()

      const weakCount = pages.filter((p) => pageNeedsOcr(p.text)).length
      if (weakCount === 0) {
        markOcrReady(bookId)
        emit({
          bookId,
          phase: 'done',
          done: pages.length,
          total: pages.length,
          message: 'Metin hazır — OCR gerekmedi',
          engine: 'pdfjs',
        })
        return
      }

      emit({
        bookId,
        phase: 'running',
        done: 0,
        total: Math.min(weakCount, 80),
        message: 'İlk sayfalar hazırlanıyor (sonra kalanlar)…',
        engine: 'browser',
      })

      const finalPages = await ocrWeakPagesInBrowser(buf, pages, {
        signal: ac.signal,
        priorityCount: 5,
        onProgress: async (p) => {
          await cachePageTexts(bookId, p.pages)
          const eta =
            p.done > 0 && p.total > p.done
              ? ` · ~${Math.max(1, Math.round(((p.total - p.done) * 8) / 60))} dk kaldı`
              : ''
          emit({
            bookId,
            phase: 'running',
            done: p.done,
            total: p.total,
            message: p.usable
              ? `İlk sayfalar hazır — okumaya başlayabilirsin (${p.done}/${p.total})${eta}`
              : `Sayfa ${p.pageNumber} (${p.done}/${p.total})${eta}`,
            engine: 'browser',
          })
        },
      })

      if (ac.signal.aborted) return
      await cachePageTexts(bookId, finalPages)
      markOcrReady(bookId)
      emit({
        bookId,
        phase: 'done',
        done: finalPages.length,
        total: finalPages.length,
        message: 'PDF hazır — Studium’da okuyabilirsin',
        engine: 'browser',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emit({
        bookId,
        phase: 'error',
        done: 0,
        total: 0,
        message: msg,
      })
    } finally {
      jobs.delete(bookId)
    }
  })()
}

export function cancelBackgroundOcr(bookId: string) {
  const ac = jobs.get(bookId)
  if (ac) {
    ac.abort()
    jobs.delete(bookId)
  }
}
