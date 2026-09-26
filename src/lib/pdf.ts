import * as pdfjsLib from 'pdfjs-dist'
import type { PageText } from './slidingWindow'
import { sanitizeForPostgres } from './sanitize'

// Vite sometimes breaks the local worker ?url import; pin worker to the same
// pdfjs-dist version via CDN (matches package version at runtime).
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export async function extractPdfText(file: File): Promise<{
  title: string
  totalPages: number
  pages: PageText[]
}> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pages: PageText[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = sanitizeForPostgres(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )

    pages.push({ pageNumber, text })
  }

  const title = sanitizeForPostgres(
    file.name.replace(/\.pdf$/i, '') || 'Untitled book',
  )

  return {
    title,
    totalPages: pdf.numPages,
    pages,
  }
}
