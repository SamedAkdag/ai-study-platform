import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const MAX_TEXT_PAGES = 80
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 54
const FONT_SIZE = 11
const LINE_H = 15

export const UPLOAD_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.txt,.md,.markdown,application/pdf,image/png,image/jpeg,image/webp,image/gif,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown'

export const UPLOAD_HINT =
  'PDF, Word, görsel veya metin · en fazla 50 MB'

type Kind = 'pdf' | 'image' | 'docx' | 'text'

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function detectKind(file: File): Kind | null {
  const t = (file.type || '').toLowerCase()
  const ext = extOf(file.name)

  if (t === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    t.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
  ) {
    return 'image'
  }
  if (
    t ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return 'docx'
  }
  if (
    t.startsWith('text/') ||
    ['txt', 'md', 'markdown'].includes(ext)
  ) {
    return 'text'
  }
  return null
}

export function isSupportedUpload(file: File): boolean {
  return detectKind(file) != null
}

function baseTitle(name: string): string {
  return name.replace(/\.[^.]+$/i, '') || 'Untitled'
}

function wrapLines(text: string, measure: (s: string) => number, maxW: number) {
  const out: string[] = []
  const paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n')
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (measure(next) <= maxW) {
        line = next
      } else {
        if (line) out.push(line)
        if (measure(w) <= maxW) {
          line = w
        } else {
          // hard-break long tokens
          let chunk = ''
          for (const ch of w) {
            const tryChunk = chunk + ch
            if (measure(tryChunk) <= maxW) chunk = tryChunk
            else {
              if (chunk) out.push(chunk)
              chunk = ch
            }
          }
          line = chunk
        }
      }
    }
    if (line) out.push(line)
  }
  return out
}

async function textToPdfFile(
  text: string,
  title: string,
): Promise<{ file: File; truncated: boolean }> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const maxW = PAGE_W - MARGIN * 2
  const measure = (s: string) => font.widthOfTextAtSize(s, FONT_SIZE)
  const lines = wrapLines(text, measure, maxW)
  const usable = PAGE_H - MARGIN * 2 - 28
  const linesPerPage = Math.max(1, Math.floor(usable / LINE_H))
  const maxLines = MAX_TEXT_PAGES * linesPerPage
  const truncated = lines.length > maxLines

  let pageCount = 0
  for (let i = 0; i < lines.length; i += linesPerPage) {
    if (pageCount >= MAX_TEXT_PAGES) break
    const page = doc.addPage([PAGE_W, PAGE_H])
    let y = PAGE_H - MARGIN
    if (pageCount === 0 && title) {
      page.drawText(title.slice(0, 80), {
        x: MARGIN,
        y: y - 4,
        size: 14,
        font: bold,
        color: rgb(0.12, 0.18, 0.16),
      })
      y -= 28
    }
    const chunk = lines.slice(i, i + linesPerPage)
    for (const line of chunk) {
      if (!line) {
        y -= LINE_H
        continue
      }
      page.drawText(line, {
        x: MARGIN,
        y: y - FONT_SIZE,
        size: FONT_SIZE,
        font,
        color: rgb(0.1, 0.12, 0.14),
        maxWidth: maxW,
      })
      y -= LINE_H
      if (y < MARGIN) break
    }
    pageCount += 1
  }

  if (doc.getPageCount() === 0) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    page.drawText('(Boş belge)', {
      x: MARGIN,
      y: PAGE_H - MARGIN - 14,
      size: 12,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })
  }

  const bytes = await doc.save()
  return {
    file: new File([bytes], `${baseTitle(title)}.pdf`, {
      type: 'application/pdf',
    }),
    truncated,
  }
}

async function imagesToPdfFile(file: File): Promise<File> {
  const doc = await PDFDocument.create()
  const buf = await file.arrayBuffer()
  const ext = extOf(file.name)
  const t = (file.type || '').toLowerCase()
  let image
  if (t.includes('png') || ext === 'png') {
    image = await doc.embedPng(buf)
  } else if (t.includes('webp') || ext === 'webp') {
    // pdf-lib has no webp — rasterize via canvas
    image = await embedViaCanvas(doc, file)
  } else if (t.includes('gif') || ext === 'gif') {
    image = await embedViaCanvas(doc, file)
  } else {
    try {
      image = await doc.embedJpg(buf)
    } catch {
      image = await embedViaCanvas(doc, file)
    }
  }

  const iw = image.width
  const ih = image.height
  const maxW = PAGE_W - MARGIN * 2
  const maxH = PAGE_H - MARGIN * 2
  const scale = Math.min(maxW / iw, maxH / ih, 1)
  const w = iw * scale
  const h = ih * scale
  const page = doc.addPage([PAGE_W, PAGE_H])
  page.drawImage(image, {
    x: (PAGE_W - w) / 2,
    y: (PAGE_H - h) / 2,
    width: w,
    height: h,
  })

  const bytes = await doc.save()
  return new File([bytes], `${baseTitle(file.name)}.pdf`, {
    type: 'application/pdf',
  })
}

async function embedViaCanvas(
  doc: PDFDocument,
  file: File,
): Promise<Awaited<ReturnType<PDFDocument['embedPng']>>> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadHtmlImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas yok')
    ctx.drawImage(img, 0, 0)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG dönüşümü başarısız'))),
        'image/png',
      )
    })
    return doc.embedPng(await pngBlob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Görsel okunamadı'))
    img.src = url
  })
}

async function docxToPdfFile(
  file: File,
): Promise<{ file: File; truncated: boolean }> {
  const mammoth = await import('mammoth')
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  const text = (result.value || '').trim()
  if (!text) {
    throw new Error('Word dosyasından metin çıkarılamadı.')
  }
  return textToPdfFile(text, baseTitle(file.name))
}

/**
 * Convert any supported upload into a PDF File for the existing study pipeline.
 */
export async function normalizeUploadToPdf(file: File): Promise<{
  pdf: File
  sourceKind: Kind
  converted: boolean
  truncated: boolean
}> {
  const kind = detectKind(file)
  if (!kind) {
    throw new Error(
      'Desteklenen türler: PDF, Word (.docx), görsel (PNG/JPG/WebP), TXT/MD.',
    )
  }
  if (kind === 'pdf') {
    return { pdf: file, sourceKind: kind, converted: false, truncated: false }
  }
  if (kind === 'image') {
    return {
      pdf: await imagesToPdfFile(file),
      sourceKind: kind,
      converted: true,
      truncated: false,
    }
  }
  if (kind === 'docx') {
    const { file: pdf, truncated } = await docxToPdfFile(file)
    return { pdf, sourceKind: kind, converted: true, truncated }
  }
  const text = await file.text()
  const { file: pdf, truncated } = await textToPdfFile(
    text,
    baseTitle(file.name),
  )
  return {
    pdf,
    sourceKind: kind,
    converted: true,
    truncated,
  }
}
