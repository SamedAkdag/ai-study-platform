import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import {
  annotationAiLabel,
  annotationKindLabel,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import { isFlowInsert } from '@/lib/pdfInserts'
import { getExportPalette, type ExportPalette } from '@/lib/moodTheme'

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

/** Download raw markdown file. */
export function downloadNotesMarkdown(
  notes: ExportableNote[],
  meta: { bookTitle: string; chapterTitle?: string },
): void {
  const md = notesToMarkdown(notes, meta)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `${slug(meta.bookTitle)}-notlar-${stamp}.md`
  a.click()
  URL.revokeObjectURL(url)
}

/** Export kitaba ekler as a styled .pdf download. */
export async function downloadNotesPdf(
  notes: ExportableNote[],
  meta: { bookTitle: string; chapterTitle?: string },
): Promise<void> {
  await markdownToStyledPdf(
    notesToMarkdown(notes, meta),
    meta,
    `${slug(meta.bookTitle)}-notlar`,
  )
}

/** Export Anlatım markdown as a styled .pdf download. */
export async function downloadMarkdownAsPdf(
  markdown: string,
  meta: PdfMeta,
): Promise<void> {
  const body = markdown.trim()
  if (!body) return
  const md = [
    `# ${meta.bookTitle}`,
    meta.chapterTitle ? `## ${meta.chapterTitle}` : '',
    meta.subtitle ? `_${meta.subtitle}_` : '',
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n')

  const base = slug(meta.chapterTitle || meta.bookTitle)
  await markdownToStyledPdf(md, meta, `${base}-anlatim`)
}

/**
 * Render markdown as styled HTML, snapshot with html2canvas, slice to A4 PDF.
 * Host stays on-screen (off to the side, opacity 1) so capture is never blank.
 */
async function markdownToStyledPdf(
  md: string,
  meta: { bookTitle: string },
  fileBase: string,
): Promise<void> {
  const palette = getExportPalette()
  const host = document.createElement('div')
  host.setAttribute('data-pdf-export', '1')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '720px',
    padding: '0',
    margin: '0',
    background: palette.paper,
    color: palette.ink,
    zIndex: '2147483646',
    opacity: '1',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>)

  host.innerHTML = buildStyledDocument(md, meta.bookTitle, palette)
  document.body.appendChild(host)

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready
    }
    // Let layout settle
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    await new Promise((r) => setTimeout(r, 80))

    const target = host.querySelector('.pdf-doc') as HTMLElement
    if (!target || target.scrollHeight < 8) {
      throw new Error('PDF içeriği oluşmadı')
    }

    const scale = 2
    const canvas = await html2canvas(target, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: palette.paper,
      logging: false,
      width: target.scrollWidth,
      height: target.scrollHeight,
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    })

    if (canvas.width < 2 || canvas.height < 2) {
      throw new Error('PDF görüntüsü boş')
    }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const margin = 12
    const printableW = pageW - margin * 2
    const printableH = pageH - margin * 2

    // Full canvas mapped to printable width
    const imgWmm = printableW
    const imgHmm = (canvas.height * imgWmm) / canvas.width
    const pageContentHmm = printableH
    const totalPages = Math.max(1, Math.ceil(imgHmm / pageContentHmm))

    // Source slice height in canvas pixels per PDF page
    const slicePx = (pageContentHmm / imgHmm) * canvas.height
    const ink255 = palette.inkRgb.map((n) => Math.round(n * 255)) as [
      number,
      number,
      number,
    ]
    const mark255 = palette.inkMutedRgb.map((n) => Math.round(n * 255)) as [
      number,
      number,
      number,
    ]

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) pdf.addPage()

      const srcY = Math.floor(i * slicePx)
      const srcH = Math.min(Math.ceil(slicePx), canvas.height - srcY)
      if (srcH <= 0) break

      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = srcH
      const ctx = pageCanvas.getContext('2d')
      if (!ctx) continue
      ctx.fillStyle = palette.paper
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      ctx.drawImage(
        canvas,
        0,
        srcY,
        canvas.width,
        srcH,
        0,
        0,
        canvas.width,
        srcH,
      )

      const sliceHmm = (srcH * imgWmm) / canvas.width
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        margin,
        margin,
        imgWmm,
        sliceHmm,
      )

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(mark255[0]!, mark255[1]!, mark255[2]!)
      pdf.text('Studium', pageW - margin, pageH - 6, { align: 'right' })
      pdf.setTextColor(ink255[0]!, ink255[1]!, ink255[2]!)
    }

    const stamp = new Date().toISOString().slice(0, 10)
    pdf.save(`${fileBase}-${stamp}.pdf`)
  } finally {
    host.remove()
  }
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2">$1</a>',
    )
}

function splitTableCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  if (cells.length < 1) return false
  return cells.every((c) => {
    const x = c.replace(/\s/g, '')
    return /^:?-{2,}:?$/.test(x)
  })
}

function parseAlign(cell: string): 'left' | 'center' | 'right' {
  const x = cell.replace(/\s/g, '')
  const left = x.startsWith(':')
  const right = x.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

function looksLikeTable(lines: string[], i: number): boolean {
  const row = lines[i]?.trim()
  const next = lines[i + 1]?.trim()
  if (!row || !next || !row.includes('|')) return false
  return isTableSeparator(next)
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const headerCells = splitTableCells(lines[start])
  const aligns = splitTableCells(lines[start + 1]).map(parseAlign)
  let i = start + 2
  const bodyRows: string[][] = []
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t || !t.includes('|') || isTableSeparator(t)) break
    // Stop if it looks like a new block (heading etc.) without pipes as table
    if (/^#{1,3}\s/.test(t)) break
    bodyRows.push(splitTableCells(t))
    i++
  }

  const colCount = Math.max(
    headerCells.length,
    ...bodyRows.map((r) => r.length),
    aligns.length,
  )

  const pad = (cells: string[]) => {
    const row = cells.slice(0, colCount)
    while (row.length < colCount) row.push('')
    return row
  }

  const alignAt = (idx: number) => aligns[idx] || 'left'

  const thead = pad(headerCells)
    .map(
      (c, idx) =>
        `<th style="text-align:${alignAt(idx)}">${inlineMd(c)}</th>`,
    )
    .join('')

  const tbody = bodyRows
    .map((row) => {
      const cells = pad(row)
        .map(
          (c, idx) =>
            `<td style="text-align:${alignAt(idx)}">${inlineMd(c)}</td>`,
        )
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('\n')

  const html = `<div class="table-wrap"><table>
<thead><tr>${thead}</tr></thead>
<tbody>
${tbody}
</tbody>
</table></div>`

  return { html, next: i }
}

/** Markdown → semantic HTML (tables, lists, headings) for PDF / insert export. */
export function markdownToHtml(md: string): string {
  return mdToHtml(md)
}

/** Markdown → semantic HTML for the styled print document. */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>')
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      i++
      continue
    }

    if (looksLikeTable(lines, i)) {
      closeList()
      const table = renderTable(lines, i)
      out.push(table.html)
      i = table.next
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
      const level = h[1].length
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`)
      i++
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      closeList()
      const quoteLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
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
      out.push(`<li>${inlineMd(ul[1])}</li>`)
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
      out.push(`<li>${inlineMd(ol[2])}</li>`)
      i++
      continue
    }

    if (
      trimmed.startsWith('_') &&
      trimmed.endsWith('_') &&
      trimmed.length > 2 &&
      !trimmed.slice(1, -1).includes('_')
    ) {
      closeList()
      out.push(`<p class="meta">${inlineMd(trimmed.slice(1, -1))}</p>`)
      i++
      continue
    }

    // Paragraph: gather consecutive non-empty non-special lines
    closeList()
    const para: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const n = lines[i].trim()
      if (!n) break
      if (looksLikeTable(lines, i)) break
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

function buildStyledDocument(
  md: string,
  bookTitle: string,
  palette: ExportPalette,
): string {
  const body = mdToHtml(md)
  const softBorder = `color-mix(in srgb, ${palette.accent} 28%, transparent)`
  return `
<div class="pdf-doc">
  <style>
    .pdf-doc {
      box-sizing: border-box;
      width: 720px;
      padding: 40px 44px 48px;
      background: ${palette.paper};
      color: ${palette.ink};
      font-family: "Literata", "Iowan Old Style", "Times New Roman", Georgia, serif;
      font-size: 15.5px;
      line-height: 1.62;
      text-align: left;
    }
    .pdf-doc * { box-sizing: border-box; }
    .pdf-doc h1 {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      line-height: 1.2;
      margin: 0 0 0.35rem;
      color: ${palette.ink};
    }
    .pdf-doc h2 {
      font-size: 1.2rem;
      font-weight: 650;
      margin: 0 0 0.85rem;
      color: ${palette.accentDeep};
    }
    .pdf-doc h3 {
      font-size: 1.02rem;
      font-weight: 650;
      margin: 1.45rem 0 0.5rem;
      color: ${palette.accentMid};
    }
    .pdf-doc .meta {
      color: ${palette.inkMuted};
      font-size: 0.9rem;
      margin: 0 0 1.25rem;
      font-style: italic;
    }
    .pdf-doc p {
      margin: 0 0 0.85rem;
    }
    .pdf-doc strong { font-weight: 700; color: ${palette.accentDeep}; }
    .pdf-doc em { font-style: italic; color: ${palette.inkMuted}; }
    .pdf-doc code {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.88em;
      background: ${palette.accentSoft};
      padding: 0.1em 0.35em;
      border-radius: 4px;
    }
    .pdf-doc blockquote {
      margin: 0.5rem 0 1rem;
      padding: 0.65rem 0.9rem;
      border-left: 3px solid ${palette.accent};
      background: linear-gradient(90deg, ${palette.accentSoft} 0%, ${palette.paper} 100%);
      color: ${palette.inkMuted};
      font-size: 0.95rem;
      border-radius: 0 8px 8px 0;
    }
    .pdf-doc ul, .pdf-doc ol {
      margin: 0 0 0.95rem;
      padding-left: 1.35rem;
    }
    .pdf-doc li { margin: 0.25rem 0; }
    .pdf-doc hr {
      border: 0;
      border-top: 1px solid ${softBorder};
      margin: 1.35rem 0;
    }
    .pdf-doc .table-wrap {
      width: 100%;
      margin: 0.85rem 0 1.25rem;
      overflow: hidden;
      border-radius: 10px;
      border: 1px solid ${softBorder};
      background: ${palette.surface};
    }
    .pdf-doc table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .pdf-doc thead th,
    .pdf-doc tbody td {
      border: 0;
    }
    .pdf-doc thead th {
      background: ${palette.accentSoft};
      color: ${palette.accentDeep};
      font-weight: 700;
      font-size: 0.82rem;
      letter-spacing: 0.01em;
      padding: 0.55rem 0.7rem;
      vertical-align: bottom;
    }
    .pdf-doc tbody td {
      padding: 0.5rem 0.7rem;
      color: ${palette.ink};
      vertical-align: top;
      background: ${palette.surface};
    }
    .pdf-doc tbody tr:nth-child(even) td {
      background: ${palette.accentSoft};
    }
    .pdf-doc a { color: ${palette.accentMid}; text-decoration: none; }
    .pdf-doc .pdf-footer {
      margin-top: 2.25rem;
      padding-top: 0.85rem;
      border-top: 1px solid ${softBorder};
      font-size: 0.78rem;
      color: ${palette.inkSoft};
      font-family: "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
    }
  </style>
  ${body}
  <p class="pdf-footer">Studium · ${escapeHtml(bookTitle)}</p>
</div>
`
}
