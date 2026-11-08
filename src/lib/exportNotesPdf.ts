import { jsPDF } from 'jspdf'
import {
  annotationAiLabel,
  annotationKindLabel,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import { isFlowInsert } from '@/lib/pdfInserts'
import { getExportPalette } from '@/lib/moodTheme'

export type ExportableNote = PdfAnnotation

type PdfMeta = {
  bookTitle: string
  chapterTitle?: string
  subtitle?: string
}

/** Flow inserts worth exporting (AI / notes / cites with body). */
export function exportableNotes(annotations: PdfAnnotation[]): ExportableNote[] {
  return annotations
    .filter((a) => isFlowInsert(a) && !!(a.body && a.body.trim()))
    .sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt))
}

export function notesToMarkdown(
  notes: ExportableNote[],
  meta: { bookTitle: string; chapterTitle?: string },
): string {
  const lines: string[] = [
    `# ${meta.bookTitle}`,
    meta.chapterTitle ? `## ${meta.chapterTitle}` : '',
    '',
    `_Studium not özeti · ${notes.length} ek_`,
    '',
  ].filter(Boolean) as string[]

  for (const n of notes) {
    const label =
      n.kind === 'ai'
        ? annotationAiLabel(n.aiMode)
        : annotationKindLabel(n.kind)
    lines.push(`### ${label} · s. ${n.page}`)
    lines.push('')
    lines.push(`> ${n.quote.replace(/\n/g, ' ').slice(0, 280)}`)
    lines.push('')
    if (n.question) {
      lines.push(`**Soru:** ${n.question}`)
      lines.push('')
    }
    lines.push(n.body || '')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
}

/** Download raw markdown file. */
export function downloadNotesMarkdown(
  notes: ExportableNote[],
  meta: { bookTitle: string; chapterTitle?: string },
): void {
  const md = notesToMarkdown(notes, meta)
  const stamp = new Date().toISOString().slice(0, 10)
  triggerBlobDownload(
    new Blob([md], { type: 'text/markdown;charset=utf-8' }),
    `${slug(meta.bookTitle)}-notlar-${stamp}.md`,
  )
}

/** Download Anlatım as a normal .md file (selectable text, no image raster). */
export function downloadMarkdownFile(
  markdown: string,
  meta: PdfMeta,
): void {
  const body = markdown.trim()
  if (!body) {
    throw new Error('İndirilecek anlatım metni yok')
  }
  const md = [
    `# ${meta.bookTitle}`,
    meta.chapterTitle ? `## ${meta.chapterTitle}` : '',
    meta.subtitle ? `_${meta.subtitle}_` : '',
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n')

  const stamp = new Date().toISOString().slice(0, 10)
  const base = slug(meta.chapterTitle || meta.bookTitle)
  triggerBlobDownload(
    new Blob([md], { type: 'text/markdown;charset=utf-8' }),
    `${base}-anlatim-${stamp}.md`,
  )
}

/** @deprecated Prefer downloadMarkdownFile — kept for call-site compatibility. */
export function downloadMarkdownAsPdf(
  markdown: string,
  meta: PdfMeta,
): Promise<void> {
  downloadMarkdownFile(markdown, meta)
  return Promise.resolve()
}

/** Export kitaba ekler as a real text PDF (no screenshot / image pages). */
export async function downloadNotesPdf(
  notes: ExportableNote[],
  meta: { bookTitle: string; chapterTitle?: string },
): Promise<void> {
  await markdownToTextPdf(
    notesToMarkdown(notes, meta),
    `${slug(meta.bookTitle)}-notlar`,
  )
}

type TextBlock =
  | { type: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'meta'; text: string }
  | { type: 'li'; ordered: boolean; text: string }
  | { type: 'hr' }
  | { type: 'gap' }

function stripInlineMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
}

function mdToBlocks(md: string): TextBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: TextBlock[] = []
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i]!.trim()
    if (!trimmed) {
      out.push({ type: 'gap' })
      i++
      continue
    }
    if (trimmed === '---' || trimmed === '***') {
      out.push({ type: 'hr' })
      i++
      continue
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (h) {
      const level = h[1]!.length
      out.push({
        type: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3',
        text: stripInlineMd(h[2]!),
      })
      i++
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim())) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ''))
        i++
      }
      out.push({ type: 'quote', text: stripInlineMd(quoteLines.join(' ')) })
      continue
    }
    const ul = /^[-*•]\s+(.+)$/.exec(trimmed)
    if (ul) {
      out.push({ type: 'li', ordered: false, text: stripInlineMd(ul[1]!) })
      i++
      continue
    }
    const ol = /^(\d+)[.)]\s+(.+)$/.exec(trimmed)
    if (ol) {
      out.push({ type: 'li', ordered: true, text: stripInlineMd(ol[2]!) })
      i++
      continue
    }
    if (
      trimmed.startsWith('_') &&
      trimmed.endsWith('_') &&
      trimmed.length > 2 &&
      !trimmed.slice(1, -1).includes('_')
    ) {
      out.push({ type: 'meta', text: stripInlineMd(trimmed.slice(1, -1)) })
      i++
      continue
    }

    const para: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const n = lines[i]!.trim()
      if (!n) break
      if (
        /^(#{1,3})\s+/.test(n) ||
        /^>\s?/.test(n) ||
        /^[-*•]\s+/.test(n) ||
        /^\d+[.)]\s+/.test(n) ||
        n === '---' ||
        n === '***'
      ) {
        break
      }
      para.push(n)
      i++
    }
    out.push({ type: 'p', text: stripInlineMd(para.join(' ')) })
  }

  return out
}

/**
 * Write markdown as selectable text into a PDF.
 * No HTML snapshot / canvas / JPEG pages.
 */
async function markdownToTextPdf(md: string, fileBase: string): Promise<void> {
  const palette = getExportPalette()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 16
  const maxW = pageW - margin * 2
  let y = margin

  const ink = palette.inkRgb.map((n) => Math.round(n * 255)) as [
    number,
    number,
    number,
  ]
  const muted = palette.inkMutedRgb.map((n) => Math.round(n * 255)) as [
    number,
    number,
    number,
  ]
  const accent = palette.accentDeepRgb.map((n) => Math.round(n * 255)) as [
    number,
    number,
    number,
  ]
  const paper = palette.paperRgb.map((n) => Math.round(n * 255)) as [
    number,
    number,
    number,
  ]

  const fillPage = () => {
    pdf.setFillColor(paper[0]!, paper[1]!, paper[2]!)
    pdf.rect(0, 0, pageW, pageH, 'F')
  }
  fillPage()

  const ensureSpace = (need: number) => {
    if (y + need <= pageH - margin) return
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(muted[0]!, muted[1]!, muted[2]!)
    pdf.text('Studium', pageW - margin, pageH - 8, { align: 'right' })
    pdf.addPage()
    fillPage()
    y = margin
  }

  const writeWrapped = (
    text: string,
    opts: {
      size: number
      style?: 'normal' | 'bold' | 'italic'
      color: [number, number, number]
      lineGap?: number
      indent?: number
    },
  ) => {
    const style = opts.style || 'normal'
    pdf.setFont('helvetica', style)
    pdf.setFontSize(opts.size)
    pdf.setTextColor(opts.color[0], opts.color[1], opts.color[2])
    const indent = opts.indent || 0
    const lines = pdf.splitTextToSize(text, maxW - indent) as string[]
    const lineH = (opts.size * 0.4) + (opts.lineGap ?? 1.1)
    for (const line of lines) {
      ensureSpace(lineH + 2)
      pdf.text(line, margin + indent, y)
      y += lineH
    }
    y += 1.2
  }

  let olIndex = 0
  for (const block of mdToBlocks(md)) {
    if (block.type === 'gap') {
      y += 2
      olIndex = 0
      continue
    }
    if (block.type === 'hr') {
      ensureSpace(6)
      pdf.setDrawColor(muted[0]!, muted[1]!, muted[2]!)
      pdf.setLineWidth(0.2)
      pdf.line(margin, y, pageW - margin, y)
      y += 5
      olIndex = 0
      continue
    }
    if (block.type === 'h1') {
      olIndex = 0
      writeWrapped(block.text, { size: 18, style: 'bold', color: ink, lineGap: 1.4 })
      y += 1
      continue
    }
    if (block.type === 'h2') {
      olIndex = 0
      writeWrapped(block.text, {
        size: 14,
        style: 'bold',
        color: accent,
        lineGap: 1.3,
      })
      continue
    }
    if (block.type === 'h3') {
      olIndex = 0
      writeWrapped(block.text, {
        size: 12,
        style: 'bold',
        color: accent,
        lineGap: 1.2,
      })
      continue
    }
    if (block.type === 'meta') {
      olIndex = 0
      writeWrapped(block.text, {
        size: 10,
        style: 'italic',
        color: muted,
      })
      continue
    }
    if (block.type === 'quote') {
      olIndex = 0
      writeWrapped(block.text, {
        size: 10,
        style: 'italic',
        color: muted,
        indent: 4,
      })
      continue
    }
    if (block.type === 'li') {
      if (block.ordered) olIndex += 1
      else olIndex = 0
      const bullet = block.ordered ? `${olIndex}. ` : '• '
      writeWrapped(`${bullet}${block.text}`, {
        size: 11,
        color: ink,
        indent: 3,
      })
      continue
    }
    olIndex = 0
    writeWrapped(block.text, { size: 11, color: ink })
  }

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(muted[0]!, muted[1]!, muted[2]!)
  pdf.text('Studium', pageW - margin, pageH - 8, { align: 'right' })

  const stamp = new Date().toISOString().slice(0, 10)
  triggerBlobDownload(pdf.output('blob'), `${fileBase}-${stamp}.pdf`)
}

function slug(s: string): string {
  return (
    s
      .toLocaleLowerCase('tr')
      .replace(/[^a-z0-9çğıöşü]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'studium-notlar'
  )
}

/** Markdown → semantic HTML (tables, lists, headings) for insert export. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let listType: 'ul' | 'ol' | null = null

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const inlineMd = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')

  const closeList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>')
      listType = null
    }
  }

  while (i < lines.length) {
    const trimmed = lines[i]!.trim()
    if (!trimmed) {
      closeList()
      i++
      continue
    }
    if (trimmed === '---' || trimmed === '***') {
      closeList()
      out.push('<hr />')
      i++
      continue
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (h) {
      closeList()
      const level = h[1]!.length
      out.push(`<h${level}>${inlineMd(h[2]!)}</h${level}>`)
      i++
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      closeList()
      const quoteLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim())) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${inlineMd(quoteLines.join(' '))}</blockquote>`)
      continue
    }
    const ul = /^[-*•]\s+(.+)$/.exec(trimmed)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul>')
        listType = 'ul'
      }
      out.push(`<li>${inlineMd(ul[1]!)}</li>`)
      i++
      continue
    }
    const ol = /^(\d+)[.)]\s+(.+)$/.exec(trimmed)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol>')
        listType = 'ol'
      }
      out.push(`<li>${inlineMd(ol[2]!)}</li>`)
      i++
      continue
    }
    closeList()
    const para: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const n = lines[i]!.trim()
      if (!n) break
      if (
        /^(#{1,3})\s+/.test(n) ||
        /^>\s?/.test(n) ||
        /^[-*•]\s+/.test(n) ||
        /^\d+[.)]\s+/.test(n) ||
        n === '---' ||
        n === '***'
      ) {
        break
      }
      para.push(n)
      i++
    }
    out.push(`<p>${inlineMd(para.join(' '))}</p>`)
  }
  closeList()
  return out.join('\n')
}
