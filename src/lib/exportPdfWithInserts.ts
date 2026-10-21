import {
  PDFDocument,
  rgb,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
  type PDFFont,
  type PDFPage,
  type PDFEmbeddedPage,
} from 'pdf-lib'
import {
  annotationAiLabel,
  annotationKindLabel,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import {
  buildPageSegments,
  isFlowInsert,
  type PageInsert,
} from '@/lib/pdfInserts'
import { downloadPdfBytes, toWinAnsiSafe } from '@/lib/pdfManipulate'

const TEAL = rgb(0.059, 0.463, 0.431)
const TEAL_DEEP = rgb(0.043, 0.353, 0.329)
const INK = rgb(0.086, 0.145, 0.196)
const MUTED = rgb(0.353, 0.427, 0.486)
const CARD_BG = rgb(0.965, 0.98, 0.976)
const TABLE_HEAD = rgb(0.894, 0.953, 0.945)
const TABLE_ALT = rgb(0.95, 0.976, 0.973)
const ROW_BG = rgb(1, 1, 1)
const RULE = rgb(0.55, 0.72, 0.7)

type Align = 'left' | 'center' | 'right'

type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'para'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][]; aligns: Align[] }
  | { type: 'quote'; text: string }

type Fonts = {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
}

/**
 * Download the book PDF with AI / note inserts baked in place as real PDF
 * text and tables (vector — original pages stay selectable, not PNG).
 */
export async function downloadPdfWithInserts(input: {
  pdfBytes: Uint8Array
  annotations: PdfAnnotation[]
  filename: string
  onProgress?: (msg: string) => void
}): Promise<void> {
  const { pdfBytes, annotations, filename, onProgress } = input
  const inserts = annotations.filter(
    (a) => isFlowInsert(a) && !!(a.body && a.body.trim()),
  )

  if (!inserts.length) {
    downloadPdfBytes(pdfBytes, filename)
    return
  }

  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
    italic: await out.embedFont(StandardFonts.HelveticaOblique),
  }
  const n = srcDoc.getPageCount()

  const byPage = new Map<number, PdfAnnotation[]>()
  for (const a of inserts) {
    const list = byPage.get(a.page) || []
    list.push(a)
    byPage.set(a.page, list)
  }

  for (let i = 0; i < n; i++) {
    onProgress?.(`Sayfa ${i + 1} / ${n}…`)
    const pageInserts = byPage.get(i + 1)
    if (!pageInserts?.length) {
      const [copied] = await out.copyPages(srcDoc, [i])
      out.addPage(copied)
      continue
    }
    await composeVectorPage(out, srcDoc, i, pageInserts, fonts)
  }

  const bytes = await out.save()
  downloadPdfBytes(
    bytes,
    filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
  )
}

async function composeVectorPage(
  out: PDFDocument,
  srcDoc: PDFDocument,
  pageIndex: number,
  annotations: PdfAnnotation[],
  fonts: Fonts,
): Promise<void> {
  const srcPage = srcDoc.getPages()[pageIndex]
  if (!srcPage) return
  const { width, height } = srcPage.getSize()
  const embedded = await out.embedPage(srcPage)

  const marginX = Math.max(28, width * 0.07)
  const cardWidth = width - marginX * 2

  const pageInserts: PageInsert[] = annotations.map((a, idx) => {
    const yPct =
      typeof a.anchorTopPct === 'number'
        ? a.anchorTopPct
        : a.region
          ? a.region.topPct + a.region.heightPct
          : 0.45
    return {
      id: a.id || `ins-${idx}`,
      y: Math.min(height - 1, Math.max(1, yPct * height)),
      annotation: a,
    }
  })

  const segments = buildPageSegments(height, pageInserts)
  const cardHeights = new Map<string, number>()
  for (const seg of segments) {
    if (seg.type !== 'insert' || !seg.insert.annotation) continue
    cardHeights.set(
      seg.insert.id,
      measureInsertCard(seg.insert.annotation, cardWidth, fonts),
    )
  }

  let totalH = 0
  for (const seg of segments) {
    if (seg.type === 'band') totalH += seg.height
    else totalH += cardHeights.get(seg.insert.id) || 120
  }
  totalH = Math.max(height, totalH)

  const page = out.addPage([width, totalH])
  let top = 0

  for (const seg of segments) {
    if (seg.type === 'band') {
      const bandH = Math.max(1, seg.height)
      drawCroppedBand(page, embedded, width, height, seg.srcTop, bandH, top, totalH)
      top += bandH
      continue
    }
    const a = seg.insert.annotation
    const cardH = cardHeights.get(seg.insert.id) || 120
    if (a) {
      drawInsertCard(page, a, fonts, {
        x: marginX,
        top,
        pageH: totalH,
        width: cardWidth,
        height: cardH,
      })
    }
    top += cardH
  }
}

/** Draw a vertical slice of the source page (clipped) onto the composed page. */
function drawCroppedBand(
  page: PDFPage,
  embedded: PDFEmbeddedPage,
  srcW: number,
  srcH: number,
  srcTop: number,
  bandH: number,
  destTop: number,
  pageH: number,
): void {
  const slotBottom = pageH - destTop - bandH
  const drawY = pageH - destTop - srcH + srcTop

  page.pushOperators(
    pushGraphicsState(),
    moveTo(0, slotBottom),
    lineTo(srcW, slotBottom),
    lineTo(srcW, slotBottom + bandH),
    lineTo(0, slotBottom + bandH),
    closePath(),
    clip(),
    endPath(),
  )
  page.drawPage(embedded, {
    x: 0,
    y: drawY,
    width: srcW,
    height: srcH,
  })
  page.pushOperators(popGraphicsState())
}

function measureInsertCard(
  a: PdfAnnotation,
  width: number,
  fonts: Fonts,
): number {
  const pad = 14
  const innerW = width - pad * 2
  let h = pad
  h += 12 // label
  h += 6
  h += measureWrapped(safe(a.quote || '').slice(0, 220), fonts.italic, 10, innerW) *
    12
  if (a.question) {
    h += 6
    h += measureWrapped(`Soru · ${safe(a.question)}`, fonts.bold, 10.5, innerW) * 13
  }
  h += 10
  const blocks = parseMarkdownBlocks(a.body || '')
  for (const b of blocks) h += blockHeight(b, fonts, innerW)
  h += pad
  return Math.max(72, h)
}

function drawInsertCard(
  page: PDFPage,
  a: PdfAnnotation,
  fonts: Fonts,
  box: { x: number; top: number; pageH: number; width: number; height: number },
): void {
  const { x, top, pageH, width, height } = box
  const yBottom = pageH - top - height
  const pad = 14
  const innerW = width - pad * 2

  page.drawRectangle({
    x,
    y: yBottom,
    width,
    height,
    color: CARD_BG,
    borderColor: RULE,
    borderWidth: 0.8,
    borderDashArray: [3, 2],
  })

  let cursor = pageH - top - pad // text baseline-ish from top walking down
  const label =
    a.kind === 'ai' ? annotationAiLabel(a.aiMode) : annotationKindLabel(a.kind)

  cursor = drawLine(page, safe(label).toUpperCase(), fonts.bold, 9, TEAL_DEEP, x + pad, cursor, innerW)
  cursor -= 4

  const quote = `...${safe(a.quote || '').slice(0, 220)}${(a.quote || '').length > 220 ? '...' : ''}`
  cursor = drawWrapped(page, quote, fonts.italic, 10, MUTED, x + pad, cursor, innerW, 12)

  if (a.question) {
    cursor -= 4
    cursor = drawWrapped(
      page,
      `Soru · ${safe(a.question)}`,
      fonts.bold,
      10.5,
      INK,
      x + pad,
      cursor,
      innerW,
      13,
    )
  }

  cursor -= 8
  const blocks = parseMarkdownBlocks(a.body || '')
  for (const b of blocks) {
    cursor = drawBlock(page, b, fonts, x + pad, cursor, innerW)
    if (cursor < yBottom + pad) break
  }
}

function drawBlock(
  page: PDFPage,
  b: MdBlock,
  fonts: Fonts,
  x: number,
  cursor: number,
  width: number,
): number {
  if (b.type === 'heading') {
    const size = b.level === 1 ? 13 : b.level === 2 ? 12 : 11
    cursor -= 4
    return drawWrapped(page, b.text, fonts.bold, size, TEAL, x, cursor, width, size * 1.25)
  }
  if (b.type === 'para') {
    cursor -= 2
    return drawWrapped(page, b.text, fonts.regular, 10.5, INK, x, cursor, width, 14)
  }
  if (b.type === 'quote') {
    cursor -= 3
    const h =
      measureWrapped(b.text, fonts.italic, 10, width - 10) * 12 + 8
    page.drawRectangle({
      x,
      y: cursor - h,
      width,
      height: h,
      color: TABLE_HEAD,
    })
    page.drawRectangle({
      x,
      y: cursor - h,
      width: 2.5,
      height: h,
      color: TEAL,
    })
    return drawWrapped(
      page,
      b.text,
      fonts.italic,
      10,
      MUTED,
      x + 8,
      cursor - 4,
      width - 12,
      12,
    ) - 4
  }
  if (b.type === 'list') {
    cursor -= 2
    for (let i = 0; i < b.items.length; i++) {
      const bullet = b.ordered ? `${i + 1}. ` : '• '
      cursor = drawWrapped(
        page,
        bullet + b.items[i],
        fonts.regular,
        10.5,
        INK,
        x + 6,
        cursor,
        width - 6,
        14,
      )
      cursor -= 1
    }
    return cursor - 2
  }
  if (b.type === 'table') {
    return drawTable(page, b, fonts, x, cursor, width)
  }
  return cursor
}

function drawTable(
  page: PDFPage,
  b: Extract<MdBlock, { type: 'table' }>,
  fonts: Fonts,
  x: number,
  cursor: number,
  width: number,
): number {
  const cols = Math.max(
    b.headers.length,
    ...b.rows.map((r) => r.length),
    1,
  )
  const colW = width / cols
  const pad = 4
  const fontSize = 9
  const lineH = 11

  const cellLines = (text: string, bold: boolean) =>
    wrapText(safe(text), bold ? fonts.bold : fonts.regular, fontSize, colW - pad * 2)

  const headerLines = b.headers.map((h) => cellLines(h, true))
  while (headerLines.length < cols) headerLines.push([''])
  const headerRowH = Math.max(18, ...headerLines.map((ls) => ls.length * lineH + pad * 2))

  const body = b.rows.map((row) => {
    const cells = Array.from({ length: cols }, (_, i) => cellLines(row[i] || '', false))
    const rowH = Math.max(16, ...cells.map((ls) => ls.length * lineH + pad * 2))
    return { cells, rowH }
  })

  cursor -= 4
  let yTop = cursor

  // header bg
  page.drawRectangle({
    x,
    y: yTop - headerRowH,
    width,
    height: headerRowH,
    color: TABLE_HEAD,
    borderColor: RULE,
    borderWidth: 0.6,
  })
  for (let c = 0; c < cols; c++) {
    drawCellText(
      page,
      headerLines[c],
      fonts.bold,
      fontSize,
      TEAL_DEEP,
      x + c * colW + pad,
      yTop - pad - fontSize,
      lineH,
      b.aligns[c] || 'left',
      colW - pad * 2,
    )
  }
  yTop -= headerRowH

  body.forEach((row, ri) => {
    page.drawRectangle({
      x,
      y: yTop - row.rowH,
      width,
      height: row.rowH,
      color: ri % 2 === 0 ? ROW_BG : TABLE_ALT,
      borderColor: RULE,
      borderWidth: 0.5,
    })
    for (let c = 0; c < cols; c++) {
      drawCellText(
        page,
        row.cells[c],
        fonts.regular,
        fontSize,
        INK,
        x + c * colW + pad,
        yTop - pad - fontSize,
        lineH,
        b.aligns[c] || 'left',
        colW - pad * 2,
      )
    }
    yTop -= row.rowH
  })

  return yTop - 6
}

function drawCellText(
  page: PDFPage,
  lines: string[],
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  x: number,
  startY: number,
  lineH: number,
  align: Align,
  maxW: number,
): void {
  let y = startY
  for (const line of lines) {
    let drawX = x
    const w = font.widthOfTextAtSize(line, size)
    if (align === 'center') drawX = x + Math.max(0, (maxW - w) / 2)
    else if (align === 'right') drawX = x + Math.max(0, maxW - w)
    page.drawText(line, { x: drawX, y, size, font, color })
    y -= lineH
  }
}

function blockHeight(b: MdBlock, fonts: Fonts, width: number): number {
  if (b.type === 'heading') {
    const size = b.level === 1 ? 13 : b.level === 2 ? 12 : 11
    return 4 + measureWrapped(b.text, fonts.bold, size, width) * size * 1.25
  }
  if (b.type === 'para') {
    return 2 + measureWrapped(b.text, fonts.regular, 10.5, width) * 14
  }
  if (b.type === 'quote') {
    return 7 + measureWrapped(b.text, fonts.italic, 10, width - 10) * 12
  }
  if (b.type === 'list') {
    let h = 4
    for (const item of b.items) {
      h += measureWrapped(`• ${item}`, fonts.regular, 10.5, width - 6) * 14 + 1
    }
    return h
  }
  if (b.type === 'table') {
    const cols = Math.max(b.headers.length, ...b.rows.map((r) => r.length), 1)
    const colW = width / cols
    const lineH = 11
    const pad = 4
    const headerH = Math.max(
      18,
      ...b.headers.map(
        (h) => wrapText(safe(h), fonts.bold, 9, colW - pad * 2).length * lineH + pad * 2,
      ),
    )
    let h = 10 + headerH
    for (const row of b.rows) {
      const rowH = Math.max(
        16,
        ...Array.from({ length: cols }, (_, i) =>
          wrapText(safe(row[i] || ''), fonts.regular, 9, colW - pad * 2).length *
            lineH +
          pad * 2,
        ),
      )
      h += rowH
    }
    return h
  }
  return 0
}

function drawLine(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  x: number,
  cursor: number,
  _width: number,
): number {
  page.drawText(text.slice(0, 200), {
    x,
    y: cursor - size,
    size,
    font,
    color,
  })
  return cursor - size - 2
}

function drawWrapped(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  x: number,
  cursor: number,
  width: number,
  lineH: number,
): number {
  const lines = wrapText(text, font, size, width)
  let y = cursor
  for (const line of lines) {
    page.drawText(line, { x, y: y - size, size, font, color })
    y -= lineH
  }
  return y
}

function measureWrapped(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): number {
  return Math.max(1, wrapText(text, font, size, width).length)
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const raw = safe(text).replace(/\s+/g, ' ').trim()
  if (!raw) return ['']
  const words = raw.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      cur = trial
    } else {
      if (cur) lines.push(cur)
      if (font.widthOfTextAtSize(w, size) <= maxWidth) {
        cur = w
      } else {
        // hard-break long token
        let chunk = ''
        for (const ch of w) {
          const t = chunk + ch
          if (font.widthOfTextAtSize(t, size) <= maxWidth) chunk = t
          else {
            if (chunk) lines.push(chunk)
            chunk = ch
          }
        }
        cur = chunk
      }
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

function safe(s: string): string {
  return toWinAnsiSafe(s)
}

function plainInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
}

function parseMarkdownBlocks(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: MdBlock[] = []
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }

    if (looksLikeTable(lines, i)) {
      const table = parseTable(lines, i)
      out.push(table.block)
      i = table.next
      continue
    }

    if (trimmed === '---' || trimmed === '***') {
      i++
      continue
    }

    const h = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (h) {
      out.push({
        type: 'heading',
        level: h[1].length as 1 | 2 | 3,
        text: plainInline(h[2]),
      })
      i++
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      out.push({ type: 'quote', text: plainInline(quoteLines.join(' ')) })
      continue
    }

    const ul = /^[-*+]\s+(.+)$/.exec(trimmed)
    if (ul) {
      const items: string[] = []
      while (i < lines.length) {
        const m = /^[-*+]\s+(.+)$/.exec(lines[i].trim())
        if (!m) break
        items.push(plainInline(m[1]))
        i++
      }
      out.push({ type: 'list', ordered: false, items })
      continue
    }

    const ol = /^(\d+)[.)]\s+(.+)$/.exec(trimmed)
    if (ol) {
      const items: string[] = []
      while (i < lines.length) {
        const m = /^(\d+)[.)]\s+(.+)$/.exec(lines[i].trim())
        if (!m) break
        items.push(plainInline(m[2]))
        i++
      }
      out.push({ type: 'list', ordered: true, items })
      continue
    }

    const para: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const t = lines[i].trim()
      if (!t) break
      if (
        looksLikeTable(lines, i) ||
        /^(#{1,3})\s/.test(t) ||
        t.startsWith('>') ||
        /^[-*+]\s+/.test(t) ||
        /^\d+[.)]\s+/.test(t) ||
        t === '---' ||
        t === '***'
      ) {
        break
      }
      para.push(t)
      i++
    }
    out.push({ type: 'para', text: plainInline(para.join(' ')) })
  }

  return out
}

function splitTableCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  if (!cells.length) return false
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))
}

function looksLikeTable(lines: string[], i: number): boolean {
  const row = lines[i]?.trim()
  const next = lines[i + 1]?.trim()
  if (!row || !next || !row.includes('|')) return false
  return isTableSeparator(next)
}

function parseAlign(cell: string): Align {
  const x = cell.replace(/\s/g, '')
  const left = x.startsWith(':')
  const right = x.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

function parseTable(
  lines: string[],
  start: number,
): { block: Extract<MdBlock, { type: 'table' }>; next: number } {
  const headers = splitTableCells(lines[start]).map(plainInline)
  const aligns = splitTableCells(lines[start + 1]).map(parseAlign)
  let i = start + 2
  const rows: string[][] = []
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t || !t.includes('|') || isTableSeparator(t)) break
    if (/^#{1,3}\s/.test(t)) break
    rows.push(splitTableCells(t).map(plainInline))
    i++
  }
  return {
    block: { type: 'table', headers, rows, aligns },
    next: i,
  }
}
