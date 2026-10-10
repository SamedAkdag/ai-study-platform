import type { PageText } from './slidingWindow'
import { mergeOcrPages } from './pageTextQuality'

export type OcrEngine =
  | 'docling'
  | 'tesseract'
  | 'pymupdf'
  | 'none'
  | 'browser'
  | 'pdfjs'

function serviceUrl(): string | null {
  const raw = (import.meta.env.VITE_OCR_SERVICE_URL as string | undefined)?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

export async function pingOcrService(): Promise<{
  ok: boolean
  pymupdf?: boolean
  docling?: boolean
  tesseract?: boolean
}> {
  const base = serviceUrl()
  if (!base) return { ok: false }
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as {
      ok?: boolean
      pymupdf?: boolean
      docling?: boolean
      tesseract?: boolean
    }
    return {
      ok: !!data.ok,
      pymupdf: !!data.pymupdf,
      docling: !!data.docling,
      tesseract: !!data.tesseract,
    }
  } catch {
    return { ok: false }
  }
}

async function postPdf(
  path: string,
  file: Blob,
): Promise<{
  engine: OcrEngine
  pages: PageText[]
  warning?: string
  markdown?: string
}> {
  const base = serviceUrl()
  if (!base) throw new Error('PDF service URL yok')

  const body = new FormData()
  body.append(
    'file',
    file,
    file instanceof File ? file.name : 'document.pdf',
  )

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    body,
  })

  const payload = (await res.json().catch(() => ({}))) as {
    detail?: string
    engine?: OcrEngine
    pages?: Array<{ pageNumber: number; text: string }>
    warning?: string
    markdown?: string
  }

  if (!res.ok) {
    const detail =
      typeof payload.detail === 'string'
        ? payload.detail
        : `Servis hata (${res.status})`
    throw new Error(detail)
  }

  return {
    engine: payload.engine || 'pymupdf',
    pages: (payload.pages ?? []).map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text || '',
    })),
    warning: payload.warning,
    markdown: payload.markdown,
  }
}

export async function extractPdfViaService(file: Blob) {
  const result = await postPdf('/extract/pdf', file)
  const { repairTurkishText } = await import('./repairTurkish')
  return {
    ...result,
    pages: result.pages.map((p) => ({
      ...p,
      text: repairTurkishText(p.text || ''),
    })),
  }
}

/** Docling/Tesseract/PyMuPDF otomatik yol. */
export async function ocrPdfViaService(file: Blob) {
  return postPdf('/ocr/pdf?prefer=auto', file)
}

export { mergeOcrPages }
