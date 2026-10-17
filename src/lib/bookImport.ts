import { supabase } from './supabase'
import { cachePageTexts, loadCachedPdf } from './pdfCache'
import { uploadBookPdf } from './bookPdf'
import { pageNeedsOcr } from './pageTextQuality'
import type { PageText } from './slidingWindow'

export type ImportJobStatus = {
  bookId: string
  phase: 'idle' | 'extracting' | 'done' | 'error'
  done: number
  total: number
  message: string
  pages?: PageText[]
  usable?: boolean
  engine?: string
}

type Listener = (s: ImportJobStatus) => void

const listeners = new Set<Listener>()
const jobs = new Map<string, AbortController>()
const lastStatus = new Map<string, ImportJobStatus>()

export function subscribeImportJob(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getImportJobStatus(bookId: string): ImportJobStatus | null {
  return lastStatus.get(bookId) ?? null
}

function emit(status: ImportJobStatus) {
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
      new CustomEvent('studium-import', { detail: status }),
    )
  } catch {
    /* ignore */
  }
}

async function finishBook(
  bookId: string,
  pages: PageText[],
  subject?: string | null,
) {
  await cachePageTexts(bookId, pages)
  await supabase
    .from('books')
    .update({
      subject: subject?.trim() || null,
      total_pages: pages.length,
      progress_step: 'imported',
      status: 'ready',
      error_message: null,
    })
    .eq('id', bookId)
}

async function runProgressiveImport(input: {
  bookId: string
  source: File | Blob
  subject?: string | null
  titleHint?: string
  uploadFile?: File
}): Promise<void> {
  const { bookId, source } = input
  if (!bookId || jobs.has(bookId)) return

  const ac = new AbortController()
  jobs.set(bookId, ac)

  emit({
    bookId,
    phase: 'extracting',
    done: 0,
    total: 0,
    message: 'Sayfalar hazırlanıyor…',
  })

  const uploadPromise = input.uploadFile
    ? uploadBookPdf(bookId, input.uploadFile).catch((err) => {
        console.warn('PDF storage upload failed', err)
      })
    : Promise.resolve()

  try {
    // 1) PyMuPDF servisi — metinli PDF için en iyi yapı (başlık/markdown)
    const { pingOcrService, extractPdfViaService } = await import('./ocrRemote')
    const health = await pingOcrService()

    if (health.ok && health.pymupdf && !ac.signal.aborted) {
      emit({
        bookId,
        phase: 'extracting',
        done: 0,
        total: 1,
        message: 'PyMuPDF ile yapılandırılıyor…',
        engine: 'pymupdf',
      })
      try {
        const remote = await extractPdfViaService(source)
        if (ac.signal.aborted) return

        const pages = remote.pages
        const usable = pages.some((p) => !pageNeedsOcr(p.text))
        const weak = pages.filter((p) => pageNeedsOcr(p.text)).length

        emit({
          bookId,
          phase: 'extracting',
          done: pages.length,
          total: pages.length,
          message:
            weak > 0
              ? `Markdown hazır · ${weak} zayıf sayfa tarayıcıda tamamlanacak`
              : 'Markdown hazır (PyMuPDF)',
          pages,
          usable: usable || undefined,
          engine: 'pymupdf',
        })

        await finishBook(bookId, pages, input.subject)

        // Zayıf/tarama sayfalar → sadece onları OCR et (iyi markdown’ı bozma)
        if (weak > 0) {
          const { ocrWeakPagesInBrowser } = await import('./ocrBrowser')
          const buf = await source.arrayBuffer()
          const merged = await ocrWeakPagesInBrowser(buf, pages, {
            signal: ac.signal,
            onProgress: async (p) => {
              emit({
                bookId,
                phase: 'extracting',
                done: p.done,
                total: p.total,
                message: `OCR ${p.done}/${p.total} · sayfa ${p.pageNumber}`,
                pages: p.pages,
                usable: true,
                engine: 'pymupdf+ocr',
              })
              await cachePageTexts(bookId, p.pages)
            },
          })
          if (!ac.signal.aborted) {
            await finishBook(bookId, merged, input.subject)
            emit({
              bookId,
              phase: 'done',
              done: merged.length,
              total: merged.length,
              message: 'Tüm sayfalar hazır',
              pages: merged,
              usable: true,
              engine: 'pymupdf+ocr',
            })
            await uploadPromise
            return
          }
        }

        emit({
          bookId,
          phase: 'done',
          done: pages.length,
          total: pages.length,
          message: 'Studium markdown hazır',
          pages,
          usable: true,
          engine: 'pymupdf',
        })
        await uploadPromise
        return
      } catch (err) {
        console.warn('PyMuPDF extract failed, browser fallback', err)
      }
    }

    // 2) Tarayıcı progressive (pdf.js + gerekirse OCR)
    const { processPdfPagesProgressive } = await import('./ocrBrowser')
    let lastCacheAt = 0

    const pages = await processPdfPagesProgressive(source, {
      signal: ac.signal,
      onPage: async (ev) => {
        const label =
          ev.source === 'ocr'
            ? `Sayfa ${ev.pageNumber} OCR`
            : ev.source === 'empty'
              ? `Sayfa ${ev.pageNumber} (metin yok)`
              : `Sayfa ${ev.pageNumber} hazır`

        emit({
          bookId,
          phase: 'extracting',
          done: ev.pageNumber,
          total: ev.total,
          message: `${label} · ${ev.pageNumber}/${ev.total}`,
          pages: ev.pages,
          usable: ev.firstReadable || undefined,
          engine: 'browser',
        })

        if (
          ev.pageNumber === 1 ||
          ev.pageNumber - lastCacheAt >= 3 ||
          ev.pageNumber === ev.total
        ) {
          lastCacheAt = ev.pageNumber
          await cachePageTexts(bookId, ev.pages)
        }
      },
    })

    if (ac.signal.aborted) return

    await finishBook(bookId, pages, input.subject)

    emit({
      bookId,
      phase: 'done',
      done: pages.length,
      total: pages.length,
      message: 'Tüm sayfalar hazır',
      pages,
      usable: true,
      engine: 'browser',
    })

    await uploadPromise
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('background import failed', err)
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
}

export function startBackgroundBookImport(input: {
  bookId: string
  file: File
  subject?: string | null
  titleHint?: string
}): void {
  void runProgressiveImport({
    bookId: input.bookId,
    source: input.file,
    subject: input.subject,
    titleHint: input.titleHint,
    uploadFile: input.file,
  })
}

export function startBackgroundTextExtract(input: {
  bookId: string
  titleHint?: string
}): void {
  void (async () => {
    const blob = await loadCachedPdf(input.bookId)
    if (!blob) {
      emit({
        bookId: input.bookId,
        phase: 'error',
        done: 0,
        total: 0,
        message: 'PDF bulunamadı',
      })
      return
    }
    await runProgressiveImport({
      bookId: input.bookId,
      source: blob,
      titleHint: input.titleHint,
    })
  })()
}
