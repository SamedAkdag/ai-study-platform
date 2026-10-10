import * as pdfjsLib from 'pdfjs-dist'

let ready = false

/** Yerel worker — sadece PDF işi başlarken yükle (ana sayfayı kilitleme). */
export async function ensurePdfWorker(): Promise<void> {
  if (ready && pdfjsLib.GlobalWorkerOptions.workerSrc) return
  const workerUrl = (
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  ready = true
}

export { pdfjsLib }
