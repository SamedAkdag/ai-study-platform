import {
  PDFDocument,
  rgb,
  StandardFonts,
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
  isMarginNote,
  type PageInsert,
} from '@/lib/pdfInserts'
import {
  clonePdfBytes,
  downloadPdfBytes,
  ensureEditablePdf,
  loadPdfDoc,
  toWinAnsiSafe,
} from '@/lib/pdfManipulate'
import type { PdfRegion } from '@/lib/pdfRegion'
import { getExportPalette, type RgbTuple } from '@/lib/moodTheme'

function toPdfRgb(t: RgbTuple) {
  return rgb(t[0], t[1], t[2])
}

/** Theme-tinted colors for inserts baked onto (usually white) book pages. */
function insertInkPalette() {
  const p = getExportPalette()
  // Always keep body ink dark enough for white PDF pages.
  const darkInk: RgbTuple =
    p.themeId === 'night'
      ? [0.1, 0.17, 0.14]
      : p.inkRgb[0] + p.inkRgb[1] + p.inkRgb[2] > 1.8
        ? [0.1, 0.17, 0.14]
        : p.inkRgb
  const accent =
    p.themeId === 'night'
      ? ([0.24, 0.42, 0.33] as RgbTuple)
      : p.accentRgb
  const accentDeep =
    p.themeId === 'night'
      ? ([0.14, 0.23, 0.17] as RgbTuple)
      : p.accentDeepRgb[0] + p.accentDeepRgb[1] + p.accentDeepRgb[2] > 1.6
        ? accent
        : p.accentDeepRgb
  const soft =
    p.themeId === 'night'
      ? ([0.84, 0.9, 0.87] as RgbTuple)
      : p.accentSoftRgb
  return {
    TEAL: toPdfRgb(accent),
    TEAL_DEEP: toPdfRgb(accentDeep),
    INK: toPdfRgb(darkInk),
    MUTED: toPdfRgb(
      p.themeId === 'night' ? ([0.35, 0.42, 0.39] as RgbTuple) : p.inkMutedRgb,
    ),
    CARD_BG: toPdfRgb(soft),
    TABLE_HEAD: toPdfRgb(soft),
    TABLE_ALT: toPdfRgb([
      (soft[0] + 1) / 2,
      (soft[1] + 1) / 2,
      (soft[2] + 1) / 2,
    ]),
    ROW_BG: rgb(1, 1, 1),
    RULE: toPdfRgb([
      (accent[0] + 0.55) / 2,
      (accent[1] + 0.72) / 2,
      (accent[2] + 0.7) / 2,
    ]),
  }
}

/** Live theme colors — refreshed at each export entry. */
let TEAL = rgb(0.176, 0.275, 0.208)
let TEAL_DEEP = rgb(0.141, 0.227, 0.173)
let INK = rgb(0.102, 0.169, 0.141)
let MUTED = rgb(0.353, 0.42, 0.388)
let CARD_BG = rgb(0.902, 0.937, 0.918)
let TABLE_HEAD = CARD_BG
let TABLE_ALT = rgb(0.95, 0.976, 0.973)
let ROW_BG = rgb(1, 1, 1)
let RULE = rgb(0.55, 0.72, 0.7)

function refreshInsertColors() {
  const c = insertInkPalette()
  TEAL = c.TEAL
  TEAL_DEEP = c.TEAL_DEEP
  INK = c.INK
  MUTED = c.MUTED
  CARD_BG = c.CARD_BG
  TABLE_HEAD = c.TABLE_HEAD
  TABLE_ALT = c.TABLE_ALT
  ROW_BG = c.ROW_BG
  RULE = c.RULE
}

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

const MARKUP_KINDS = new Set([
  'highlight',
  'underline',
  'strike',
  'omit',
  'bookmark',
])

function isPageMarkup(a: PdfAnnotation): boolean {
  return (
    MARKUP_KINDS.has(a.kind) &&
    !!(a.region || (a.regions && a.regions.length))
  )
}

function markupBoxes(a: PdfAnnotation): PdfRegion[] {
  if (a.regions && a.regions.length) return a.regions
  return a.region ? [a.region] : []
}

/**
 * Download the book PDF with highlights / underlines / etc. burned onto pages
 * and AI / note inserts baked in place as real PDF text (vector).
 */
export async function downloadPdfWithInserts(input: {
  pdfBytes: Uint8Array
  annotations: PdfAnnotation[]
  filename: string
  onProgress?: (msg: string) => void
}): Promise<void> {
  refreshInsertColors()
  const { pdfBytes, annotations, filename, onProgress } = input
  const inserts = annotations.filter(
    (a) => isFlowInsert(a) && !!(a.body && a.body.trim()),
  )
  const markups = annotations.filter(isPageMarkup)
  const margins = annotations.filter(isMarginNote)

  onProgress?.('İşaretler uygulanıyor…')
  let srcBytes = await ensureEditablePdf(pdfBytes)
  if (markups.length) {
    srcBytes = await bakePageMarkups(srcBytes, markups, onProgress)
  }

  const hasSideNotes = margins.length > 0
  if (!inserts.length && !hasSideNotes) {
    downloadPdfBytes(
      srcBytes,
      filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
    )
    return
  }

  // Separate loads: mixing copyPages + embedPage on one doc often throws PDFDict errors.
  const srcForCopy = await loadPdfDoc(srcBytes)
  const out = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
    italic: await out.embedFont(StandardFonts.HelveticaOblique),
  }
  const n = srcForCopy.getPageCount()

  const insertsByPage = new Map<number, PdfAnnotation[]>()
  for (const a of inserts) {
    const list = insertsByPage.get(a.page) || []
    list.push(a)
    insertsByPage.set(a.page, list)
  }
  const marginsByPage = new Map<number, PdfAnnotation[]>()
  for (const a of margins) {
    const list = marginsByPage.get(a.page) || []
    list.push(a)
    marginsByPage.set(a.page, list)
  }

  for (let i = 0; i < n; i++) {
    onProgress?.(`Sayfa ${i + 1} / ${n}…`)
    const pageInserts = insertsByPage.get(i + 1) || []
    const pageMargins = marginsByPage.get(i + 1) || []
    if (!pageInserts.length && !pageMargins.length) {
      const [copied] = await out.copyPages(srcForCopy, [i])
      out.addPage(copied)
      continue
    }
    if (!pageInserts.length && pageMargins.length) {
      await copyPageWithMarginRail(out, srcForCopy, i, pageMargins, fonts)
      continue
    }
    await composeVectorPage(out, srcBytes, i, pageInserts, fonts, pageMargins)
  }

  const bytes = await out.save()
  downloadPdfBytes(
    bytes,
    filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
  )
}

const MARGIN_RAIL = 148

async function copyPageWithMarginRail(
  out: PDFDocument,
  srcDoc: PDFDocument,
  pageIndex: number,
  margins: PdfAnnotation[],
  fonts: Fonts,
): Promise<void> {
  const srcPage = srcDoc.getPages()[pageIndex]
  if (!srcPage) return
  const { width, height } = srcPage.getSize()
  const embedded = await out.embedPage(srcPage)
  const page = out.addPage([width + MARGIN_RAIL, height])
  page.drawPage(embedded, { x: 0, y: 0, width, height })
  drawMarginNotes(page, margins, fonts, {
    contentWidth: width,
    contentHeight: height,
    pageHeight: height,
    yShift: () => 0,
  })
}

function drawMarginNotes(
  page: PDFPage,
  notes: PdfAnnotation[],
  fonts: Fonts,
  opts: {
    contentWidth: number
    contentHeight: number
    pageHeight: number
    yShift: (pageYFromTop: number) => number
  },
) {
  const railX = opts.contentWidth + 6
  const railW = MARGIN_RAIL - 14
  const size = 7.2
  const lineH = 9.2

  for (const a of notes) {
    const y0 =
      (typeof a.anchorTopPct === 'number'
        ? a.anchorTopPct
        : a.region?.topPct ?? 0.4) * opts.contentHeight
    const topFromTop = y0 + opts.yShift(y0)
    const label = a.kind === 'bookmark' ? 'Yer imi' : 'Not'
    const raw = (a.body || '').trim() || a.quote
    const body = toWinAnsiSafe(raw).slice(0, 220)
    const lines = wrapText(body, fonts.regular, size, railW)
    const boxH = 12 + lines.length * lineH + 8
    const topY = opts.pageHeight - topFromTop
    const boxBottom = Math.max(8, topY - boxH)

    page.drawRectangle({
      x: railX,
      y: boxBottom,
      width: railW,
      height: boxH,
      color: CARD_BG,
      borderColor: RULE,
      borderWidth: 0.6,
    })
    page.drawRectangle({
      x: railX,
      y: boxBottom,
      width: 2.5,
      height: boxH,
      color: TEAL,
    })
    page.drawText(toWinAnsiSafe(label), {
      x: railX + 7,
      y: boxBottom + boxH - 11,
      size: 6.5,
      font: fonts.bold,
      color: TEAL_DEEP,
    })
    let ty = boxBottom + boxH - 22
    for (const line of lines.slice(0, 12)) {
      page.drawText(line, {
        x: railX + 7,
        y: ty,
        size,
        font: fonts.regular,
        color: INK,
      })
      ty -= lineH
    }
  }
}

/** Burn highlight / underline / strike / omit / bookmark regions onto page content. */
async function bakePageMarkups(
  pdfBytes: Uint8Array,
  markups: PdfAnnotation[],
  onProgress?: (msg: string) => void,
): Promise<Uint8Array> {
  refreshInsertColors()
  const doc = await loadPdfDoc(pdfBytes)
  const pages = doc.getPages()
  const byPage = new Map<number, PdfAnnotation[]>()
  for (const a of markups) {
    const list = byPage.get(a.page) || []
    list.push(a)
    byPage.set(a.page, list)
  }

  for (const [pageNum, list] of byPage) {
    const page = pages[pageNum - 1]
    if (!page) continue
    onProgress?.(`Vurgu / işaret · s. ${pageNum}…`)
    const { width, height } = page.getSize()
    for (const a of list) {
      for (const box of markupBoxes(a)) {
        drawMarkupBox(page, a.kind, box, width, height)
      }
    }
  }

  return clonePdfBytes(await doc.save())
}

function drawMarkupBox(
  page: PDFPage,
  kind: PdfAnnotation['kind'],
  r: PdfRegion,
  pageWidth: number,
  pageHeight: number,
) {
  const x = r.leftPct * pageWidth
  const w = Math.max(2, r.widthPct * pageWidth)
  const h = Math.max(2, r.heightPct * pageHeight)
  const y = pageHeight - r.topPct * pageHeight - h

  if (kind === 'highlight') {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(0.96, 0.82, 0.4),
      opacity: 0.42,
    })
    return
  }
  if (kind === 'underline') {
    page.drawRectangle({
      x,
      y: y + 1,
      width: w,
      height: 1.75,
      color: TEAL,
      opacity: 0.92,
    })
    return
  }
  if (kind === 'strike') {
    page.drawRectangle({
      x,
      y: y + h * 0.45,
      width: w,
      height: 1.6,
      color: rgb(0.72, 0.11, 0.11),
      opacity: 0.88,
    })
    return
  }
  if (kind === 'omit') {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(0.94, 0.94, 0.94),
      opacity: 0.95,
    })
    return
  }
  if (kind === 'bookmark') {
    page.drawRectangle({
      x: Math.max(0, x - 3),
      y,
      width: 3.2,
      height: h,
      color: TEAL_DEEP,
      opacity: 0.9,
    })
  }
}

/**
 * Crop a vertical band via MediaBox (no clip operators) → embed into `out`.
 * Avoids pdf-lib "Expected instance of PDFDict" from clip+drawPage.
 */
async function embedCroppedBand(
  out: PDFDocument,
  srcBytes: Uint8Array,
  pageIndex: number,
  srcTop: number,
  bandH: number,
): Promise<{ embed: PDFEmbeddedPage; width: number; height: number }> {
  const src = await loadPdfDoc(srcBytes)
  const srcPage = src.getPages()[pageIndex]
  if (!srcPage) throw new Error(`Sayfa ${pageIndex + 1} yok`)
  const { width: srcW, height: srcH } = srcPage.getSize()
  const h = Math.max(1, Math.min(bandH, srcH))
  const top = Math.max(0, Math.min(srcTop, srcH - h))

  const temp = await PDFDocument.create()
  const full = await temp.embedPage(srcPage)
  const bandPage = temp.addPage([srcW, h])
  // Align source top `top` with the top of the short page (PDF y grows up).
  bandPage.drawPage(full, {
    x: 0,
    y: h - srcH + top,
    width: srcW,
    height: srcH,
  })

  const tempBytes = clonePdfBytes(await temp.save())
  const donor = await loadPdfDoc(tempBytes)
  const [embed] = await out.embedPdf(donor, [0])
  return { embed, width: srcW, height: h }
}

async function composeVectorPage(
  out: PDFDocument,
  srcBytes: Uint8Array,
  pageIndex: number,
  annotations: PdfAnnotation[],
  fonts: Fonts,
  marginNotes: PdfAnnotation[] = [],
): Promise<void> {
  const probe = await loadPdfDoc(srcBytes)
  const srcPage = probe.getPages()[pageIndex]
  if (!srcPage) return
  const { width, height } = srcPage.getSize()

  const marginX = Math.max(28, width * 0.07)
  const cardWidth = width - marginX * 2
  const rail = marginNotes.length > 0 ? MARGIN_RAIL : 0

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

  const page = out.addPage([width + rail, totalH])
  let top = 0

  for (const seg of segments) {
    if (seg.type === 'band') {
      const bandH = Math.max(1, seg.height)
      const { embed, width: bw, height: bh } = await embedCroppedBand(
        out,
        srcBytes,
        pageIndex,
        seg.srcTop,
        bandH,
      )
      page.drawPage(embed, {
        x: 0,
        y: totalH - top - bh,
        width: bw,
        height: bh,
      })
      top += bh
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

  if (marginNotes.length) {
    const sortedInserts = [...pageInserts].sort((a, b) => a.y - b.y)
    drawMarginNotes(page, marginNotes, fonts, {
      contentWidth: width,
      contentHeight: height,
      pageHeight: totalH,
      yShift: (pageY) => {
        let extra = 0
        for (const ins of sortedInserts) {
          if (pageY >= ins.y) extra += cardHeights.get(ins.id) || 0
        }
        return extra
      },
    })
  }
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
