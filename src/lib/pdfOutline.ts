import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfOutlineItem = {
  title: string
  page: number | null
  items: PdfOutlineItem[]
}

type OutlineNode = {
  title?: string
  dest?: unknown
  items?: OutlineNode[]
}

/** Flatten pdf.js outline into a clickable TOC with page numbers. */
export async function loadPdfOutline(
  doc: PDFDocumentProxy,
): Promise<PdfOutlineItem[]> {
  try {
    const raw = (await doc.getOutline()) as OutlineNode[] | null
    if (!raw?.length) return []
    return await Promise.all(raw.map((n) => mapNode(doc, n)))
  } catch {
    return []
  }
}

async function mapNode(
  doc: PDFDocumentProxy,
  node: OutlineNode,
): Promise<PdfOutlineItem> {
  const page = await destToPage(doc, node.dest)
  const kids = Array.isArray(node.items) ? node.items : []
  return {
    title: (node.title || 'Bölüm').trim() || 'Bölüm',
    page,
    items: await Promise.all(kids.map((k) => mapNode(doc, k))),
  }
}

async function destToPage(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    let explicit: unknown = dest
    if (typeof dest === 'string') {
      explicit = await doc.getDestination(dest)
    }
    if (!Array.isArray(explicit) || !explicit[0]) return null
    const pageIndex = await doc.getPageIndex(explicit[0] as never)
    if (!Number.isFinite(pageIndex)) return null
    return pageIndex + 1
  } catch {
    return null
  }
}
