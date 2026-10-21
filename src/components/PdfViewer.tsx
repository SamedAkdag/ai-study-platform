import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { pdfjsLib, ensurePdfWorker } from '@/lib/pdfjs'
import { useTextSelection } from '@/hooks/useTextSelection'
import type {
  PdfSelectionAction,
  PdfSelectionPayload,
} from '@/types/pdfSelection'
import PageJumpControl from '@/components/PageJumpControl'
import SelectionActionBar from '@/components/SelectionActionBar'
import PdfInsertBlock from '@/components/PdfInsertBlock'
import PdfOutlinePanel from '@/components/PdfOutlinePanel'
import {
  removePdfAnnotation,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import {
  buildPageSegments,
  isFlowInsert,
  resolveInsertY,
  type PageInsert,
} from '@/lib/pdfInserts'
import { findQuoteAnchor, normQuote } from '@/lib/pdfQuoteAnchor'
import { loadPdfOutline, type PdfOutlineItem } from '@/lib/pdfOutline'
import {
  clampRegion,
  cropCanvasRegionToDataUrl,
  regionFromAnchor,
  regionFromClientRect,
  type PdfRegion,
} from '@/lib/pdfRegion'
import { contextAroundRegion } from '@/lib/pdfRegionContext'
import { fetchPdfBytes } from '@/lib/pdfManipulate'
import { samplePaperColor } from '@/lib/pdfCanvasEdit'
import {
  applyWordEditToCanvas,
  bakeWordEditsIntoPage,
  buildEditSpanFromSelection,
  buildWordGroups,
  findWordGroupAt,
  groupsIntersectingClientRect,
  samplePaperNearWord,
  type PdfWordGroup,
} from '@/lib/pdfWordEdit'

export type { PdfSelectionAction, PdfSelectionPayload }

type Props = {
  src: string
  /** Session PDF bytes — when set, viewer loads from these (edits reload here). */
  data?: Uint8Array | null
  onWorkingBytesChange?: (bytes: Uint8Array) => void
  startPage?: number
  endPage?: number
  page?: number
  onPageChange?: (page: number) => void
  omittedQuotes?: string[]
  highlightedQuotes?: string[]
  underlinedQuotes?: string[]
  struckQuotes?: string[]
  redactedQuotes?: string[]
  annotations?: PdfAnnotation[]
  bookId?: string
  chapterId?: string
  chapterTitle?: string
  onAnnotationsChange?: () => void
  onAction?: (payload: PdfSelectionPayload, action: PdfSelectionAction) => void
  className?: string
  hideChrome?: boolean
}

type PageView = {
  width: number
  height: number
}

type PageRaster = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  textHtml: string
}

type WordEditDraft = {
  group: PdfWordGroup
  paperColor: string
  inkColor: string
  /** Word ids covered by a sentence span (blanked under the new text). */
  coveredIds: string[]
}

export default function PdfViewer({
  src,
  data = null,
  onWorkingBytesChange,
  startPage = 1,
  endPage,
  page: pageProp,
  onPageChange,
  omittedQuotes = [],
  highlightedQuotes = [],
  underlinedQuotes = [],
  struckQuotes = [],
  redactedQuotes = [],
  annotations = [],
  bookId,
  chapterId,
  chapterTitle,
  onAnnotationsChange,
  onAction,
  className = '',
  hideChrome = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pageHostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const measureLayerRef = useRef<HTMLDivElement>(null)
  const bytesRef = useRef<Uint8Array | null>(null)
  const [raster, setRaster] = useState<PageRaster | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const renderGenRef = useRef(0)
  const [pageInternal, setPageInternal] = useState(pageProp ?? startPage)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.15)
  const [pageView, setPageView] = useState<PageView | null>(null)
  const [wordGroups, setWordGroups] = useState<PdfWordGroup[]>([])
  const [wordDraft, setWordDraft] = useState<WordEditDraft | null>(null)
  const [wordDraftText, setWordDraftText] = useState('')
  const wordEditsRef = useRef<Map<string, PdfWordGroup>>(new Map())
  const wordInputRef = useRef<HTMLInputElement>(null)
  const wordHitsRef = useRef<HTMLDivElement | null>(null)
  const ptrRef = useRef({ x: 0, y: 0, dragging: false })
  const lastHoverIdRef = useRef<string | null>(null)
  const [outline, setOutline] = useState<PdfOutlineItem[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [docEpoch, setDocEpoch] = useState(0)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  /** Marquee mode for charts / figures (vision) — not text selection. */
  const [areaMode, setAreaMode] = useState(false)
  const [areaDrag, setAreaDrag] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const [areaPick, setAreaPick] = useState<{
    payload: PdfSelectionPayload
    rect: { top: number; left: number; bottom: number; right: number }
  } | null>(null)
  const areaPtrRef = useRef<{
    active: boolean
    pointerId: number
    x0: number
    y0: number
  } | null>(null)

  function cancelActiveRender() {
    try {
      renderTaskRef.current?.cancel()
    } catch {
      /* already done */
    }
    renderTaskRef.current = null
  }

  const controlled = typeof pageProp === 'number'
  const page = controlled ? pageProp : pageInternal
  const canMarkup = !!bookId || !!onAction

  function setPage(next: number | ((p: number) => number)) {
    const raw = typeof next === 'function' ? next(page) : next
    const hi =
      numPages > 0 || endPage
        ? endPage
          ? Math.min(endPage, numPages > 0 ? numPages : endPage)
          : numPages
        : Math.max(raw, minPage)
    const value = Math.min(Math.max(raw, minPage), Math.max(minPage, hi))
    if (value === page) return
    // Flush word edits before leaving page (rasterize only then)
    void flushPageEdits(page).finally(() => {
      if (!controlled) setPageInternal(value)
      onPageChange?.(value)
    })
  }

  const { ctx: selection, clear: clearSelection, hold, snapshot } =
    useTextSelection(pageHostRef)

  function clearAreaPick() {
    setAreaPick(null)
    setAreaDrag(null)
    areaPtrRef.current = null
  }

  function exitAreaMode() {
    setAreaMode(false)
    clearAreaPick()
  }

  useEffect(() => {
    if (!areaMode) return
    clearSelection()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitAreaMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearSelection stable enough
  }, [areaMode])

  useEffect(() => {
    // Leaving the page drops a pending marquee
    clearAreaPick()
  }, [page])

  const minPage = Math.max(1, startPage)
  const maxPage = endPage
    ? Math.max(minPage, endPage)
    : numPages > 0
      ? numPages
      : Math.max(minPage, page)

  useEffect(() => {
    if (controlled) return
    if (numPages <= 0 && !endPage) return
    setPageInternal((p) => Math.min(Math.max(p, minPage), maxPage))
  }, [minPage, maxPage, controlled, numPages, endPage])

  useEffect(() => {
    if (!controlled) return
    if (numPages <= 0 && !endPage) return
    const hi = endPage
      ? Math.min(endPage, numPages > 0 ? numPages : endPage)
      : numPages
    if (hi <= 0) return
    const clamped = Math.min(Math.max(pageProp, minPage), hi)
    if (clamped !== pageProp) onPageChange?.(clamped)
  }, [controlled, pageProp, minPage, numPages, endPage, onPageChange])

  const prevPageRef = useRef(page)
  useEffect(() => {
    setWordDraft(null)
    const prev = prevPageRef.current
    if (prev !== page) {
      // Parent-driven page change: flush edits on the page we left
      void flushPageEdits(prev)
      prevPageRef.current = page
    }
    // Do NOT clear wordEditsRef for current page — session overlays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // One source of truth: in-memory bytes when present, else URL (avoids double fetch)
  const loadSource: Uint8Array | string =
    data && data.byteLength > 0 ? data : src

  // Load / reload PDF document from data or src
  useEffect(() => {
    let cancelled = false
    cancelActiveRender()
    setLoading(true)
    setError(null)
    setPageView(null)

    void (async () => {
      try {
        await ensurePdfWorker()
        const prev = docRef.current
        docRef.current = null
        if (prev) await prev.destroy().catch(() => undefined)
        if (cancelled) return

        const raw =
          typeof loadSource === 'string'
            ? await fetchPdfBytes(loadSource)
            : loadSource
        if (cancelled) return
        bytesRef.current = raw

        // Copy — pdf.js may transfer the buffer
        const copy = new Uint8Array(raw.byteLength)
        copy.set(raw)
        const doc = await pdfjsLib.getDocument({ data: copy }).promise
        if (cancelled) {
          await doc.destroy()
          return
        }
        docRef.current = doc
        setNumPages(doc.numPages)
        const toc = await loadPdfOutline(doc)
        if (cancelled) return
        setOutline(toc)
        const hi = endPage ? Math.min(endPage, doc.numPages) : doc.numPages
        const lo = Math.min(startPage, hi)
        const next = Math.min(Math.max(page, lo), hi)
        if (!controlled) setPageInternal(next)
        else if (next !== page) onPageChange?.(next)
        setDocEpoch((e) => e + 1)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF açılamadı')
          setOutline([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      cancelActiveRender()
      docRef.current?.destroy().catch(() => undefined)
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSource, startPage, endPage])

  // Full-page raster + textLayer (bands slice this when AI/not inserts exist)
  useEffect(() => {
    const doc = docRef.current
    if (!doc || loading) return

    const gen = ++renderGenRef.current
    cancelActiveRender()
    let cancelled = false

    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled || gen !== renderGenRef.current) return

        const viewport = pdfPage.getViewport({ scale })
        const offscreen = document.createElement('canvas')
        offscreen.width = viewport.width
        offscreen.height = viewport.height
        const ctx = offscreen.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('Canvas yok')

        const task = pdfPage.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
        if (cancelled || gen !== renderGenRef.current) return
        renderTaskRef.current = null

        const textContent = await pdfPage.getTextContent()
        if (cancelled || gen !== renderGenRef.current) return

        const groups = buildWordGroups(textContent, viewport, scale)
        for (const g of groups) {
          const saved = wordEditsRef.current.get(`${page}:${g.id}`)
          if (saved) g.currentText = saved.currentText
        }
        for (const g of groups) {
          if (g.currentText !== g.str) {
            applyWordEditToCanvas(ctx, g, scale)
          }
        }
        if (cancelled || gen !== renderGenRef.current) return
        setWordGroups(groups)

        const measureHost = measureLayerRef.current
        const textLayerDiv = document.createElement('div')
        textLayerDiv.className = 'textLayer pdf-text-layer'
        textLayerDiv.style.width = `${viewport.width}px`
        textLayerDiv.style.height = `${viewport.height}px`
        if (measureHost) {
          measureHost.innerHTML = ''
          measureHost.style.width = `${viewport.width}px`
          measureHost.style.height = `${viewport.height}px`
          measureHost.appendChild(textLayerDiv)
        }

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
        if (cancelled || gen !== renderGenRef.current) return

        applyMarkup(textLayerDiv, page, {
          omittedQuotes,
          highlightedQuotes,
          underlinedQuotes,
          struckQuotes,
          redactedQuotes,
          annotations,
          replaceDraftQuote: wordDraft?.group.currentText,
        })

        setRaster({
          canvas: offscreen,
          width: viewport.width,
          height: viewport.height,
          textHtml: textLayerDiv.innerHTML,
        })
        setPageView({ width: viewport.width, height: viewport.height })

        // Flat view (no inserts): paint onto visible canvas + live textLayer
        const vis = canvasRef.current
        const liveLayer = textLayerRef.current
        if (vis && liveLayer) {
          vis.width = viewport.width
          vis.height = viewport.height
          const vctx = vis.getContext('2d', { alpha: false })
          if (vctx) vctx.drawImage(offscreen, 0, 0)
          liveLayer.innerHTML = textLayerDiv.innerHTML
          liveLayer.className = 'textLayer pdf-text-layer'
          liveLayer.style.width = `${viewport.width}px`
          liveLayer.style.height = `${viewport.height}px`
        }
        setError(null)
      } catch (err) {
        if (cancelled || gen !== renderGenRef.current) return
        if (isRenderCancel(err)) return
        setError(err instanceof Error ? err.message : 'Sayfa çizilemedi')
      }
    })()

    return () => {
      cancelled = true
      cancelActiveRender()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale, loading, numPages, docEpoch])

  // Lightweight: re-apply highlight classes without canvas re-render
  useEffect(() => {
    const layer = textLayerRef.current
    if (!layer || !pageView) return
    clearMarkup(layer)
    applyMarkup(layer, page, {
      omittedQuotes,
      highlightedQuotes,
      underlinedQuotes,
      struckQuotes,
      redactedQuotes,
      annotations,
      replaceDraftQuote: wordDraft?.group.str,
    })
  }, [
    pageView,
    page,
    omittedQuotes,
    highlightedQuotes,
    underlinedQuotes,
    struckQuotes,
    redactedQuotes,
    annotations,
    wordDraft,
  ])

  useEffect(() => {
    if (!wordDraft) return
    const t = window.setTimeout(() => {
      const el = wordInputRef.current
      if (!el) return
      el.focus()
      // Seçilen cümle input’ta — profesyonel: tümünü seç, hemen üzerine yaz
      el.select()
    }, 30)
    return () => window.clearTimeout(t)
  }, [wordDraft])

  /** Open editor; optional transferredText = selection → input (cümle aktarımı). */
  function openWordEditor(
    group: PdfWordGroup,
    opts?: { transferredText?: string; coveredIds?: string[] },
  ) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    let paperColor = '#ffffff'
    if (ctx) {
      paperColor = samplePaperNearWord(ctx, group, scale)
      applyWordEditToCanvas(
        ctx,
        { ...group, currentText: '' },
        scale,
        { paperColor, inkColor: '#111' },
      )
    }
    const text =
      opts?.transferredText?.replace(/\s+/g, ' ').trim() || group.currentText
    setWordDraft({
      group: { ...group, currentText: text },
      paperColor,
      inkColor: '#111111',
      coveredIds: opts?.coveredIds || [group.id],
    })
    setWordDraftText(text)
    clearSelection()
  }

  /**
   * Raster-bake pending word edits for a page (only when leaving page / saving).
   * Keeps text selectable during the session by not baking on every edit.
   */
  async function flushPageEdits(pageNum: number) {
    const changed = [...wordEditsRef.current.entries()]
      .filter(([k, g]) => k.startsWith(`${pageNum}:`) && g.currentText !== g.str)
      .map(([, g]) => g)
    if (!changed.length || !bytesRef.current) return
    setEditBusy(true)
    try {
      const next = await bakeWordEditsIntoPage(
        bytesRef.current,
        pageNum,
        changed,
        3,
      )
      bytesRef.current = next
      for (const k of [...wordEditsRef.current.keys()]) {
        if (k.startsWith(`${pageNum}:`)) wordEditsRef.current.delete(k)
      }
      onWorkingBytesChange?.(next)
      if (!data) {
        cancelActiveRender()
        const prev = docRef.current
        docRef.current = null
        if (prev) await prev.destroy().catch(() => undefined)
        const copy = new Uint8Array(next.byteLength)
        copy.set(next)
        const doc = await pdfjsLib.getDocument({ data: copy }).promise
        docRef.current = doc
        setNumPages(doc.numPages)
        setDocEpoch((e) => e + 1)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt başarısız')
    } finally {
      setEditBusy(false)
    }
  }

  async function commitWordEdit() {
    if (!wordDraft || editBusy) return
    const draft = wordDraft
    const text = wordDraftText.trim() || draft.group.str
    const group: PdfWordGroup = { ...draft.group, currentText: text }
    setWordDraft(null)

    if (group.currentText === group.str) {
      setDocEpoch((e) => e + 1)
      return
    }

    // Session-only: paint on canvas, keep vector text selectable until page flush
    wordEditsRef.current.set(`${page}:${group.id}`, group)
    for (const id of draft.coveredIds) {
      if (id === group.id || id.startsWith('span:')) continue
      const orig = wordGroups.find((g) => g.id === id)
      if (orig) {
        wordEditsRef.current.set(`${page}:${id}`, {
          ...orig,
          // Mark as visually replaced by span — bake uses span overlay
          currentText: orig.str,
        })
      }
    }

    setWordGroups((prev) =>
      prev.map((g) => (g.id === group.id ? group : g)),
    )

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx) {
      applyWordEditToCanvas(ctx, group, scale, {
        paperColor: draft.paperColor,
        inkColor: draft.inkColor,
      })
    }

    onAction?.(
      {
        selectedText: group.str,
        precedingContext: '',
        followingContext: '',
        page,
      },
      'replace',
    )
  }

  /** Seçili cümleyi / kelimeleri tek edit span’ine aktar. */
  function openEditorFromSelection(selectedText: string, selRect: DOMRect) {
    const host = pageHostRef.current
    if (!host) return false
    const hits = groupsIntersectingClientRect(
      wordGroups,
      selRect,
      host.getBoundingClientRect(),
    )
    if (!hits.length) return false
    const span = buildEditSpanFromSelection(hits, selectedText)
    if (!span) return false
    openWordEditor(span, {
      transferredText: selectedText,
      coveredIds: hits.map((h) => h.id),
    })
    return true
  }

  function selectionRegion(quote: string): PdfRegion | undefined {
    if (!pageView && !raster) return undefined
    const w = pageView?.width || raster?.width || 0
    const h = pageView?.height || raster?.height || 0
    if (w < 1 || h < 1) return undefined
    const layer =
      textLayerRef.current ||
      (measureLayerRef.current?.querySelector(
        '.textLayer',
      ) as HTMLElement | null)
    if (!layer) return undefined
    const anchor = findQuoteAnchor(layer, quote)
    if (!anchor) return undefined
    return regionFromAnchor(anchor, w, h)
  }

  function fireArea(action: PdfSelectionAction) {
    if (!areaPick) return
    onAction?.(areaPick.payload, action)
    exitAreaMode()
  }

  function finishAreaMarquee(clientRect: {
    left: number
    top: number
    width: number
    height: number
  }) {
    const host = pageHostRef.current
    const source =
      canvasRef.current && canvasRef.current.width > 0
        ? canvasRef.current
        : raster?.canvas
    if (!host || !source || !pageView) return
    if (clientRect.width < 16 || clientRect.height < 16) {
      setAreaDrag(null)
      return
    }

    const region = regionFromClientRect(clientRect, host)
    let imageDataUrl: string | undefined
    try {
      imageDataUrl = cropCanvasRegionToDataUrl(source, region)
    } catch {
      imageDataUrl = undefined
    }
    if (!imageDataUrl) {
      setAreaDrag(null)
      return
    }

    let paperColor: string | undefined
    try {
      const cctx = source.getContext('2d')
      if (cctx) {
        paperColor = samplePaperColor(
          cctx,
          region,
          pageView.width,
          pageView.height,
        )
      }
    } catch {
      /* ignore */
    }

    const clamped = clampRegion(region)
    const layer =
      textLayerRef.current ||
      (measureLayerRef.current?.querySelector(
        '.textLayer',
      ) as HTMLElement | null)
    const around = contextAroundRegion(layer, host, clamped, {
      maxSentences: 10,
    })

    const payload: PdfSelectionPayload = {
      selectedText: '〔Grafik / şekil〕',
      precedingContext: around.precedingContext,
      followingContext: around.followingContext,
      page,
      region: clamped,
      paperColor,
      kind: 'region',
      imageDataUrl,
    }
    setAreaPick({
      payload,
      rect: {
        top: clientRect.top,
        left: clientRect.left,
        bottom: clientRect.top + clientRect.height,
        right: clientRect.left + clientRect.width,
      },
    })
    setAreaDrag(null)
  }

  function fire(action: PdfSelectionAction) {
    const snap = snapshot()
    if (!snap?.selectedText.trim()) return
    const region =
      selectionRegion(snap.selectedText) ||
      regionFromSnap(snap.rect, pageHostRef.current, pageView)
    let paperColor: string | undefined
    try {
      const cctx = canvasRef.current?.getContext('2d')
      if (cctx && region && pageView) {
        paperColor = samplePaperColor(
          cctx,
          region,
          pageView.width,
          pageView.height,
        )
      }
    } catch {
      /* ignore */
    }
    const payload: PdfSelectionPayload = {
      selectedText: snap.selectedText,
      precedingContext: snap.precedingContext,
      followingContext: snap.followingContext,
      page,
      textStyle: snap.textStyle,
      region,
      paperColor,
    }

    if (action === 'copy') {
      void navigator.clipboard?.writeText(payload.selectedText).catch(() => undefined)
      clearSelection()
      onAction?.(payload, action)
      return
    }

    // AI / note → parent side panel (no page band slicing)
    if (
      action === 'ask' ||
      action === 'summarize' ||
      action === 'explain' ||
      action === 'note' ||
      action === 'cite'
    ) {
      onAction?.(payload, action)
      clearSelection()
      return
    }

    if (action === 'highlight' || action === 'underline' || action === 'strike') {
      onAction?.(payload, action)
      clearSelection()
      return
    }

    if (action === 'redact') {
      const host = pageHostRef.current
      const ctx = canvasRef.current?.getContext('2d')
      if (!host || !ctx || !bytesRef.current) {
        onAction?.(payload, action)
        clearSelection()
        return
      }
      const box = host.getBoundingClientRect()
      const hits = wordGroups.filter((g) => {
        const gl = box.left + g.left
        const gt = box.top + g.top
        const gr = gl + Math.max(g.width, 4)
        const gb = gt + g.fontHeight + 4
        return !(
          snap.rect.right < gl ||
          snap.rect.left > gr ||
          snap.rect.bottom < gt ||
          snap.rect.top > gb
        )
      })
      clearSelection()
      if (!hits.length) {
        onAction?.(payload, action)
        return
      }
      const redacted = hits.map((g) => ({
        ...g,
        currentText: '█'.repeat(Math.max(1, Math.min(12, g.str.length))),
      }))
      for (const g of redacted) {
        wordEditsRef.current.set(`${page}:${g.id}`, g)
        applyWordEditToCanvas(ctx, g, scale, {
          paperColor: '#111111',
          inkColor: '#111111',
        })
      }
      setWordGroups((prev) =>
        prev.map((g) => redacted.find((r) => r.id === g.id) || g),
      )
      // Session paint only — bake on page change (keeps text selectable)
      onAction?.(payload, action)
      return
    }

    // Değiştir → seçili cümleyi input’a aktar (demo + profesyonel)
    if (action === 'replace') {
      if (openEditorFromSelection(payload.selectedText, snap.rect)) return
      onAction?.(payload, action)
      clearSelection()
      return
    }

    onAction?.(payload, action)
    clearSelection()
  }

  function regionFromSnap(
    rect: DOMRect,
    host: HTMLElement | null,
    view: PageView | null,
  ): PdfRegion | undefined {
    if (!host || !view) return undefined
    const box = host.getBoundingClientRect()
    return regionFromAnchor(
      {
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        bottom: rect.bottom - box.top,
      },
      view.width,
      view.height,
    )
  }

  function floatBarStyle(anchor: {
    top: number
    left: number
    bottom: number
  }): CSSProperties {
    const gap = 10
    const barW = 320
    const barH = 78
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    let top = anchor.bottom + gap
    if (top + barH > vh - 12) {
      top = Math.max(12, anchor.top - barH - gap)
    }
    const left = Math.min(
      Math.max(8, anchor.left),
      Math.max(8, vw - barW - 8),
    )
    return { position: 'fixed', top, left, zIndex: 90 }
  }

  const toolbarStyle = selection
    ? floatBarStyle(selection.rect)
    : areaPick
      ? floatBarStyle(areaPick.rect)
      : undefined

  const showToolbar =
    !!selection && canMarkup && !editBusy && !wordDraft && !areaMode
  const showAreaToolbar =
    !!areaPick && canMarkup && !editBusy && !wordDraft

  const flowInserts: PageInsert[] = useMemo(() => {
    if (!raster) return []
    const layer = measureLayerRef.current?.querySelector(
      '.textLayer',
    ) as HTMLElement | null
    const list: PageInsert[] = []
    for (const a of annotations) {
      if (a.page !== page || !isFlowInsert(a)) continue
      list.push({
        id: a.id,
        y: resolveInsertY(a, raster.height, layer),
        annotation: a,
      })
    }
    return list
  }, [annotations, page, raster])

  const segments = useMemo(() => {
    if (!raster) return []
    return buildPageSegments(raster.height, flowInserts)
  }, [raster, flowInserts])

  const hasFlowInserts = flowInserts.length > 0

  // Re-attach flat canvas when last insert removed
  useEffect(() => {
    if (hasFlowInserts || !raster) return
    const vis = canvasRef.current
    const liveLayer = textLayerRef.current
    if (!vis || !liveLayer) return
    vis.width = raster.width
    vis.height = raster.height
    const vctx = vis.getContext('2d', { alpha: false })
    if (vctx) vctx.drawImage(raster.canvas, 0, 0)
    liveLayer.innerHTML = raster.textHtml
    liveLayer.className = 'textLayer pdf-text-layer'
    liveLayer.style.width = `${raster.width}px`
    liveLayer.style.height = `${raster.height}px`
  }, [hasFlowInserts, raster])

  return (
    <div
      className={`pdf-viewer ${className}${outlineOpen ? ' pdf-viewer--outline' : ''}`}
    >
      {!hideChrome ? (
        <div className="pdf-viewer__chrome">
          <button
            type="button"
            className={`btn-ghost text-xs${outlineOpen ? ' is-active' : ''}`}
            aria-pressed={outlineOpen}
            title="İçindekiler / yer imleri"
            onClick={() => setOutlineOpen((v) => !v)}
          >
            ≡
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={page <= minPage}
            onClick={() => setPage(page - 1)}
          >
            ←
          </button>
          <PageJumpControl
            page={page}
            minPage={minPage}
            maxPage={numPages > 0 || endPage ? maxPage : page}
            onJump={setPage}
          />
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={numPages > 0 ? page >= maxPage : false}
            onClick={() => setPage(page + 1)}
          >
            →
          </button>
          <span className="pdf-viewer__spacer" />
          <button
            type="button"
            className={`btn-ghost text-xs${areaMode ? ' is-active' : ''}`}
            aria-pressed={areaMode}
            disabled={hasFlowInserts || editBusy}
            title={
              hasFlowInserts
                ? 'Alan seçimi: önce sayfadaki ekleri kapat / düz görünüm'
                : areaMode
                  ? 'Alan seçimi açık — grafiği sürükleyerek seç (Esc: çık)'
                  : 'Grafik / şekil alanı seç (MiMo görsel)'
            }
            onClick={() => {
              if (areaMode) exitAreaMode()
              else {
                clearSelection()
                clearAreaPick()
                setAreaMode(true)
              }
            }}
          >
            ⬚ Alan
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setScale((s) => Math.max(0.7, +(s - 0.1).toFixed(2)))}
          >
            −
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setScale((s) => Math.min(2.2, +(s + 0.1).toFixed(2)))}
          >
            +
          </button>
        </div>
      ) : null}

      <div className="pdf-viewer__body">
        {outlineOpen && !hideChrome ? (
          <PdfOutlinePanel
            items={outline}
            currentPage={page}
            onJump={(p) => {
              setPage(p)
              setOutlineOpen(false)
            }}
            onClose={() => setOutlineOpen(false)}
          />
        ) : null}

        <div ref={wrapRef} className="pdf-viewer__scroll">
          {loading && <p className="muted p-4 text-sm">PDF yükleniyor…</p>}
          {error && <div className="alert-error m-3">{error}</div>}
          {editBusy && (
            <p className="muted px-4 py-1 text-xs">PDF güncelleniyor…</p>
          )}

          {/* Off-DOM measure layer for insert Y + quote geometry */}
          <div ref={measureLayerRef} className="pdf-measure-layer" aria-hidden />

          <div
            ref={pageHostRef}
            className={
              [
                hasFlowInserts
                  ? 'pdf-page-host pdf-page-host--composed'
                  : 'pdf-page-host',
                areaMode ? 'pdf-page-host--area-select' : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
            style={
              !hasFlowInserts && pageView
                ? { width: pageView.width, height: pageView.height }
                : raster && hasFlowInserts
                  ? { width: raster.width }
                  : undefined
            }
            onPointerDown={(e) => {
              if (areaMode && !hasFlowInserts && !wordDraft && !editBusy) {
                if ((e.target as HTMLElement).closest('[data-selection-toolbar]'))
                  return
                e.preventDefault()
                e.stopPropagation()
                clearSelection()
                setAreaPick(null)
                areaPtrRef.current = {
                  active: true,
                  pointerId: e.pointerId,
                  x0: e.clientX,
                  y0: e.clientY,
                }
                setAreaDrag({
                  x0: e.clientX,
                  y0: e.clientY,
                  x1: e.clientX,
                  y1: e.clientY,
                })
                try {
                  pageHostRef.current?.setPointerCapture(e.pointerId)
                } catch {
                  /* ignore */
                }
                return
              }
              ptrRef.current = { x: e.clientX, y: e.clientY, dragging: false }
            }}
            onPointerMove={(e) => {
              if (areaMode && areaPtrRef.current?.active) {
                setAreaDrag({
                  x0: areaPtrRef.current.x0,
                  y0: areaPtrRef.current.y0,
                  x1: e.clientX,
                  y1: e.clientY,
                })
                return
              }
              if (hasFlowInserts || areaMode) return
              const host = pageHostRef.current
              const layer = wordHitsRef.current
              if (!host || !layer || wordDraft) {
                if (lastHoverIdRef.current) {
                  layer
                    ?.querySelector('.pdf-word-hit.is-hover')
                    ?.classList.remove('is-hover')
                  lastHoverIdRef.current = null
                }
                return
              }
              const dx = e.clientX - ptrRef.current.x
              const dy = e.clientY - ptrRef.current.y
              if (dx * dx + dy * dy > 16) ptrRef.current.dragging = true
              const g = findWordGroupAt(
                wordGroups,
                e.clientX,
                e.clientY,
                host.getBoundingClientRect(),
              )
              const id = g?.id ?? null
              if (id === lastHoverIdRef.current) return
              layer
                .querySelector('.pdf-word-hit.is-hover')
                ?.classList.remove('is-hover')
              if (id) {
                layer
                  .querySelector(`[data-word-id="${id}"]`)
                  ?.classList.add('is-hover')
              }
              lastHoverIdRef.current = id
            }}
            onPointerUp={(e) => {
              const drag = areaPtrRef.current
              if (!areaMode || !drag?.active) return
              if (drag.pointerId !== e.pointerId) return
              areaPtrRef.current = null
              try {
                pageHostRef.current?.releasePointerCapture(e.pointerId)
              } catch {
                /* ignore */
              }
              const left = Math.min(drag.x0, e.clientX)
              const top = Math.min(drag.y0, e.clientY)
              const width = Math.abs(e.clientX - drag.x0)
              const height = Math.abs(e.clientY - drag.y0)
              finishAreaMarquee({ left, top, width, height })
            }}
            onPointerCancel={() => {
              areaPtrRef.current = null
              setAreaDrag(null)
            }}
            onPointerLeave={() => {
              if (areaMode) return
              wordHitsRef.current
                ?.querySelector('.pdf-word-hit.is-hover')
                ?.classList.remove('is-hover')
              lastHoverIdRef.current = null
            }}
            onDoubleClick={(e) => {
              if (areaMode || hasFlowInserts || wordDraft || editBusy) return
              const host = pageHostRef.current
              if (!host) return
              const g = findWordGroupAt(
                wordGroups,
                e.clientX,
                e.clientY,
                host.getBoundingClientRect(),
              )
              if (g) {
                e.preventDefault()
                openWordEditor(g)
              }
            }}
          >
            {hasFlowInserts && raster
              ? segments.map((seg) => {
                  if (seg.type === 'band') {
                    return (
                      <PdfBand
                        key={seg.key}
                        raster={raster}
                        srcTop={seg.srcTop}
                        height={seg.height}
                      />
                    )
                  }
                  const insert = seg.insert
                  return (
                    <PdfInsertBlock
                      key={seg.key}
                      annotation={insert.annotation}
                      chapterId={chapterId || bookId || ''}
                      chapterTitle={chapterTitle || 'PDF'}
                      onRemove={
                        bookId
                          ? (id) => {
                              removePdfAnnotation(bookId, id)
                              onAnnotationsChange?.()
                            }
                          : undefined
                      }
                    />
                  )
                })
              : (
                <>
                  <canvas ref={canvasRef} className="pdf-page-canvas" />
                  <div ref={textLayerRef} className="textLayer pdf-text-layer" />
                  <div ref={wordHitsRef} className="pdf-word-hits" aria-hidden>
                    {!wordDraft &&
                      wordGroups.map((g) => (
                        <div
                          key={g.id}
                          data-word-id={g.id}
                          className={`pdf-word-hit${g.currentText !== g.str ? ' is-edited' : ''}`}
                          style={{
                            left: g.left,
                            top: g.top - 2,
                            width: Math.max(g.width, 4),
                            height: g.fontHeight + 4,
                          }}
                          title={`${g.currentText} — çift tık: düzenle · sürükle: seç`}
                        />
                      ))}
                  </div>
                  {wordDraft ? (
                    <input
                      ref={wordInputRef}
                      className="pdf-word-edit"
                      type="text"
                      value={wordDraftText}
                      data-selection-toolbar
                      style={{
                        left: Math.max(0, wordDraft.group.left - 2),
                        top: Math.max(0, wordDraft.group.top - 3),
                        width: Math.max(
                          wordDraft.group.width + 48,
                          Math.min(
                            pageView?.width || 400,
                            wordDraftText.length *
                              (wordDraft.group.fontHeight * 0.55) +
                              48,
                          ),
                          160,
                        ),
                        height: wordDraft.group.fontHeight + 10,
                        fontSize: wordDraft.group.fontHeight,
                        lineHeight: `${wordDraft.group.fontHeight + 4}px`,
                        fontFamily: `"${wordDraft.group.fontName}", "Times New Roman", Times, Helvetica, Arial, sans-serif`,
                        background: wordDraft.paperColor,
                        color: wordDraft.inkColor,
                      }}
                      onChange={(e) => setWordDraftText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitWordEdit()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setWordDraft(null)
                          setDocEpoch((n) => n + 1)
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          if (wordDraft) void commitWordEdit()
                        }, 80)
                      }}
                    />
                  ) : null}
                </>
              )}

            {areaMode && (areaDrag || areaPick) ? (
              <div className="pdf-area-marquee-layer" aria-hidden>
                {(() => {
                  const host = pageHostRef.current?.getBoundingClientRect()
                  if (!host) return null
                  const box = areaPick
                    ? {
                        left: areaPick.rect.left,
                        top: areaPick.rect.top,
                        width: areaPick.rect.right - areaPick.rect.left,
                        height: areaPick.rect.bottom - areaPick.rect.top,
                      }
                    : areaDrag
                      ? {
                          left: Math.min(areaDrag.x0, areaDrag.x1),
                          top: Math.min(areaDrag.y0, areaDrag.y1),
                          width: Math.abs(areaDrag.x1 - areaDrag.x0),
                          height: Math.abs(areaDrag.y1 - areaDrag.y0),
                        }
                      : null
                  if (!box || (box.width < 2 && box.height < 2)) return null
                  return (
                    <div
                      className={`pdf-area-marquee${areaPick ? ' is-done' : ''}`}
                      style={{
                        left: box.left - host.left,
                        top: box.top - host.top,
                        width: box.width,
                        height: box.height,
                      }}
                    />
                  )
                })()}
              </div>
            ) : null}
          </div>

          {showToolbar ? (
            <SelectionActionBar
              preview={selection!.selectedText}
              hold={hold}
              onAction={fire}
              style={toolbarStyle}
            />
          ) : null}
          {showAreaToolbar ? (
            <SelectionActionBar
              variant="region"
              preview="Grafik / şekil seçildi"
              onAction={fireArea}
              style={toolbarStyle}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** One horizontal slice of the page — opens real gap for AI/not inserts. */
function PdfBand({
  raster,
  srcTop,
  height,
}: {
  raster: PageRaster
  srcTop: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = raster.width
    c.height = Math.max(1, Math.round(height))
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(
      raster.canvas,
      0,
      srcTop,
      raster.width,
      height,
      0,
      0,
      raster.width,
      height,
    )
  }, [raster, srcTop, height])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.innerHTML = raster.textHtml
    layer.style.width = `${raster.width}px`
    layer.style.height = `${raster.height}px`
    layer.style.transform = `translateY(${-srcTop}px)`
  }, [raster, srcTop])

  return (
    <div
      className="pdf-band"
      style={{ width: raster.width, height: Math.max(1, height) }}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={layerRef} className="textLayer pdf-text-layer pdf-band__text" />
    </div>
  )
}

function isRenderCancel(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string }
  return (
    e.name === 'RenderingCancelledException' ||
    e.name === 'AbortException' ||
    /cancel/i.test(e.message || '')
  )
}

const MARKUP_CLASSES = [
  'is-omitted',
  'is-highlighted',
  'is-underlined',
  'is-struck',
  'is-redacted',
] as const

function clearMarkup(layer: HTMLElement) {
  for (const span of layer.querySelectorAll('span')) {
    span.classList.remove(...MARKUP_CLASSES)
  }
}

function applyMarkup(
  layer: HTMLElement,
  page: number,
  opts: {
    omittedQuotes: string[]
    highlightedQuotes: string[]
    underlinedQuotes: string[]
    struckQuotes: string[]
    redactedQuotes: string[]
    annotations: PdfAnnotation[]
    replaceDraftQuote?: string
  },
) {
  const hide = [
    ...opts.omittedQuotes,
    ...(opts.replaceDraftQuote ? [opts.replaceDraftQuote] : []),
  ]
  markTextLayer(layer, hide, 'is-omitted')
  markTextLayer(layer, opts.highlightedQuotes, 'is-highlighted')
  markTextLayer(layer, opts.underlinedQuotes, 'is-underlined')
  markTextLayer(layer, opts.struckQuotes, 'is-struck')
  markTextLayer(layer, opts.redactedQuotes, 'is-redacted')
  for (const a of opts.annotations) {
    if (a.page !== page) continue
    if (a.kind === 'highlight') markTextLayer(layer, [a.quote], 'is-highlighted')
    else if (a.kind === 'underline')
      markTextLayer(layer, [a.quote], 'is-underlined')
    else if (a.kind === 'strike') markTextLayer(layer, [a.quote], 'is-struck')
  }
}

function markTextLayer(
  layer: HTMLElement,
  quotes: string[],
  className: string,
) {
  if (!quotes.length) return
  const spans = [...layer.querySelectorAll('span')] as HTMLElement[]
  const norms = spans.map((s) => normQuote(s.textContent || ''))

  let full = ''
  const ranges: Array<{ start: number; end: number; i: number }> = []
  for (let i = 0; i < norms.length; i++) {
    const t = norms[i]
    if (!t) {
      ranges.push({ start: full.length, end: full.length, i })
      continue
    }
    if (full.length) full += ' '
    const start = full.length
    full += t
    ranges.push({ start, end: full.length, i })
  }

  for (const quote of quotes) {
    const q = normQuote(quote)
    if (q.length < 3) continue
    let idx = full.indexOf(q)
    let matchLen = q.length
    if (idx < 0) {
      const stub = q.slice(0, Math.min(48, q.length))
      idx = full.indexOf(stub)
      matchLen = stub.length
    }
    if (idx < 0) continue
    const endAt = idx + matchLen
    for (const r of ranges) {
      if (r.end > idx && r.start < endAt) {
        spans[r.i].classList.add(className)
      }
    }
  }
}
