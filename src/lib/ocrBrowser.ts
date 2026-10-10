import { pdfjsLib, ensurePdfWorker } from './pdfjs'
import { openPdfFromSource, extractOnePageText } from './pdf'
import { pageNeedsOcr } from './pageTextQuality'
import { sanitizeForPostgres } from './sanitize'
import { createWorker, type Worker } from 'tesseract.js'
import type { PageText } from './slidingWindow'

const RENDER_SCALE = 1.15
const MAX_CANVAS_WIDTH = 1100

let sharedWorker: Worker | null = null
let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker('tur', 1, {
        logger: () => undefined,
      })
      await w.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      })
      sharedWorker = w
      return w
    })()
  }
  return workerPromise
}

async function renderPageToCanvas(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
): Promise<HTMLCanvasElement> {
  await ensurePdfWorker()
  const page = await pdf.getPage(pageNumber)
  let scale = RENDER_SCALE
  let viewport = page.getViewport({ scale })
  if (viewport.width > MAX_CANVAS_WIDTH) {
    scale = (MAX_CANVAS_WIDTH / viewport.width) * scale
    viewport = page.getViewport({ scale })
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas yok')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas
}

/** Tek sayfa OCR. */
export async function ocrOnePage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const worker = await getWorker()
  const canvas = await renderPageToCanvas(pdf, pageNumber)
  try {
    const result = await worker.recognize(canvas)
    return sanitizeForPostgres(
      (result.data.text || '').replace(/\s+/g, ' ').trim(),
    )
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export type PageProcessEvent = {
  pageNumber: number
  total: number
  text: string
  source: 'text' | 'ocr' | 'empty'
  /** Şimdiye kadar işlenen sayfalar (1..pageNumber) */
  pages: PageText[]
  /** İlk okunabilir sayfa geldi */
  firstReadable?: boolean
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

/**
 * PDF’yi sayfa sayfa işle:
 * - Metin katmanı varsa → hemen kullan
 * - Yoksa → o sayfayı OCR et
 * Her sayfa bitince callback — tüm belgeyi bekleme.
 */
export async function processPdfPagesProgressive(
  source: File | Blob | ArrayBuffer | Uint8Array,
  opts?: {
    onPage?: (ev: PageProcessEvent) => void | Promise<void>
    signal?: AbortSignal
    /** OCR’ı atla (sadece metin katmanı) */
    skipOcr?: boolean
  },
): Promise<PageText[]> {
  const pdf = await openPdfFromSource(source)
  const total = pdf.numPages
  const pages: PageText[] = []
  let sawReadable = false

  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      if (opts?.signal?.aborted) break

      let text = await extractOnePageText(pdf, pageNumber)
      let sourceKind: PageProcessEvent['source'] = 'text'

      if (pageNeedsOcr(text)) {
        if (opts?.skipOcr) {
          sourceKind = 'empty'
        } else {
          try {
            const ocr = await ocrOnePage(pdf, pageNumber)
            if (!pageNeedsOcr(ocr)) {
              text = ocr
              sourceKind = 'ocr'
            } else {
              sourceKind = text.trim() ? 'text' : 'empty'
            }
          } catch (err) {
            console.warn('page OCR failed', pageNumber, err)
            sourceKind = text.trim() ? 'text' : 'empty'
          }
        }
      }

      pages.push({ pageNumber, text })

      const readable = !pageNeedsOcr(text)
      const firstReadable = readable && !sawReadable
      if (readable) sawReadable = true

      await opts?.onPage?.({
        pageNumber,
        total,
        text,
        source: sourceKind,
        pages: pages.map((p) => ({ ...p })),
        firstReadable: firstReadable || undefined,
      })

      await yieldToMain()
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }

  return pages
}

export async function terminateBrowserOcr(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate()
    sharedWorker = null
    workerPromise = null
  }
}

/** Geriye uyumluluk — zayıf sayfaları toplu OCR. */
export async function ocrWeakPagesInBrowser(
  pdfSource: ArrayBuffer | Uint8Array | string,
  basePages: PageText[],
  opts?: {
    onProgress?: (p: {
      done: number
      total: number
      pageNumber: number
      pages: PageText[]
      usable?: boolean
    }) => void
    signal?: AbortSignal
    maxPages?: number
    priorityCount?: number
  },
): Promise<PageText[]> {
  const maxPages = opts?.maxPages ?? 80
  const priorityCount = opts?.priorityCount ?? 5
  const weak = basePages
    .filter((p) => pageNeedsOcr(p.text))
    .slice(0, maxPages)
  if (!weak.length) return basePages

  const data =
    typeof pdfSource === 'string'
      ? pdfSource
      : pdfSource instanceof Uint8Array
        ? pdfSource
        : new Uint8Array(pdfSource)

  const pdf = await openPdfFromSource(data)
  const byNum = new Map(basePages.map((p) => [p.pageNumber, p.text]))
  const ordered = [
    ...weak.slice(0, priorityCount),
    ...weak.slice(priorityCount),
  ]
  let done = 0
  let usableEmitted = false

  try {
    for (const target of ordered) {
      if (opts?.signal?.aborted) break
      try {
        const text = await ocrOnePage(pdf, target.pageNumber)
        if (text && pageNeedsOcr(byNum.get(target.pageNumber))) {
          byNum.set(target.pageNumber, text)
        }
      } catch (err) {
        console.warn('browser OCR page failed', target.pageNumber, err)
      }
      done += 1
      const pages = basePages.map((p) => ({
        pageNumber: p.pageNumber,
        text: byNum.get(p.pageNumber) || p.text,
      }))
      const usable =
        done >= Math.min(priorityCount, ordered.length) && !usableEmitted
      if (usable) usableEmitted = true
      opts?.onProgress?.({
        done,
        total: ordered.length,
        pageNumber: target.pageNumber,
        pages,
        usable: usable || undefined,
      })
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }

  return basePages.map((p) => ({
    pageNumber: p.pageNumber,
    text: byNum.get(p.pageNumber) || p.text,
  }))
}
