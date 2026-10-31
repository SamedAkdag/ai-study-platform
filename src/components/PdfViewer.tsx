import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { pdfjsLib, ensurePdfWorker } from '@/lib/pdfjs'
import { useTextSelection } from '@/hooks/useTextSelection'
import { usePdfWordSelection } from '@/hooks/usePdfWordSelection'
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
  isMarginNote,
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
import { searchPdfDocument, type PdfSearchHit } from '@/lib/pdfSearch'
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
  /** Jump from notes list — page + optional region flash */
  focusTarget?: {
    page: number
    region?: PdfRegion
    annotationId?: string
  } | null
  onFocusHandled?: () => void
}

type PageView = {
  width: number
  height: number
}

type PageRaster = {
  canvas: HTMLCanvasElement
  /** CSS layout size (hit-testing / bands) */
  width: number
  height: number
  /** Backing-store pixel ratio (Retina sharpness) */
  pixelRatio: number
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
  focusTarget = null,
  onFocusHandled,
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
  const [scale, setScale] = useState(1.35)
  /** When true, +/- zoom wins over fit-to-width */
  const userScaleLockRef = useRef(false)
  const [pageView, setPageView] = useState<PageView | null>(null)
  const [wordGroups, setWordGroups] = useState<PdfWordGroup[]>([])
  const [wordDraft, setWordDraft] = useState<WordEditDraft | null>(null)
  const [wordDraftText, setWordDraftText] = useState('')
  /** Measured heights of in-flow inserts — shifts word hit Y on composed pages. */
  const [insertHeights, setInsertHeights] = useState<Record<string, number>>(
    {},
  )
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

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<PdfSearchHit[]>([])
  const [searchIdx, setSearchIdx] = useState(0)
  const [searchBusy, setSearchBusy] = useState(false)
  const [flashRegion, setFlashRegion] = useState<PdfRegion | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  /** Preview insert Y from annotations (raster height may still be loading). */
  const flowInsertsEarly: PageInsert[] = useMemo(() => {
    const h = raster?.height || pageView?.height || 0
    if (!h) return []
    const layer = measureLayerRef.current?.querySelector(
      '.textLayer',
    ) as HTMLElement | null
    const list: PageInsert[] = []
    for (const a of annotations) {
      if (a.page !== page || !isFlowInsert(a)) continue
      list.push({
        id: a.id,
        y: resolveInsertY(a, h, layer),
        annotation: a,
      })
    }
    return list
  }, [annotations, page, raster, pageView])

  const hasFlowInserts = flowInsertsEarly.length > 0

  /** Word geometry shifted down by insert block heights (composed layout). */
  const displayWordGroups = useMemo(() => {
    if (!hasFlowInserts) return wordGroups
    const sorted = [...flowInsertsEarly].sort((a, b) => a.y - b.y)
    return wordGroups.map((g) => {
      let extra = 0
      for (const ins of sorted) {
        if (g.top >= ins.y) extra += insertHeights[ins.id] ?? 0
      }
      return extra ? { ...g, top: g.top + extra } : g
    })
  }, [wordGroups, hasFlowInserts, flowInsertsEarly, insertHeights])

  function spaceAbovePageY(pageY: number) {
    let extra = 0
    for (const ins of flowInsertsEarly) {
      if (pageY >= ins.y) extra += insertHeights[ins.id] ?? 0
    }
    return extra
  }

  /** Map composed (display) Y back to flat page Y for regions / PDF ops. */
  function pageYFromDisplay(displayY: number) {
    if (!hasFlowInserts) return displayY
    let remaining = displayY
    let cursor = 0
    const sorted = [...flowInsertsEarly].sort((a, b) => a.y - b.y)
    for (const ins of sorted) {
      const bandH = Math.max(0, ins.y - cursor)
      if (remaining <= bandH) return cursor + remaining
      remaining -= bandH
      const h = insertHeights[ins.id] ?? 0
      if (remaining <= h) return ins.y
      remaining -= h
      cursor = ins.y
    }
    return cursor + remaining
  }

  function originalWordGroup(id: string): PdfWordGroup | undefined {
    return wordGroups.find((g) => g.id === id)
  }

  /** Keep Adobe-style word select/edit even when AI inserts open page gaps. */
  const wordSelectMode = wordGroups.length > 0 && !areaMode

  const nativeSel = useTextSelection(pageHostRef)
  const wordSel = usePdfWordSelection(pageHostRef, displayWordGroups, {
    enabled: wordSelectMode,
    blocked: !!wordDraft || editBusy || areaMode,
    ignoreSelector: '[data-selection-toolbar], [data-insert-slot]',
  })

  // PDF words → geometry select; AI/note inserts → native HTML select
  const selection = wordSel.ctx ?? nativeSel.ctx
  const clearSelection = () => {
    wordSel.clear()
    nativeSel.clear()
  }
  const hold = () => {
    wordSel.hold()
    nativeSel.hold()
  }
  const snapshot = () => wordSel.snapshot() ?? nativeSel.snapshot()
  const selBands = wordSel.ctx ? wordSel.bands : null

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
    nativeSel.clear()
    wordSel.clear()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitAreaMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear on mode toggle
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

  // Drop stale interaction state on page change
  useEffect(() => {
    setWordGroups([])
    setWordDraft(null)
    setAreaMode(false)
    setAreaDrag(null)
    setAreaPick(null)
    areaPtrRef.current = null
    setFlashRegion(null)
    userScaleLockRef.current = false
  }, [page])

  // Fit page width once per page / real resize — avoid scale thrash killing selection
  useEffect(() => {
    if (loading || !numPages) return
    const el = wrapRef.current
    const doc = docRef.current
    if (!el || !doc) return

    let dead = false
    let timer: number | null = null
    let lastAvail = 0

    const fit = () => {
      if (dead || userScaleLockRef.current) return
      const avail = Math.max(280, el.clientWidth - 48)
      // Ignore sub-pixel / scrollbar jitter
      if (lastAvail && Math.abs(avail - lastAvail) < 24) return
      lastAvail = avail
      void (async () => {
        try {
          const pdfPage = await doc.getPage(page)
          if (dead || userScaleLockRef.current) return
          const base = pdfPage.getViewport({ scale: 1 })
          const next = Math.min(2.6, Math.max(0.9, avail / base.width))
          const rounded = Math.round(next * 100) / 100
          setScale((s) => (Math.abs(s - rounded) > 0.08 ? rounded : s))
        } catch {
          /* ignore */
        }
      })()
    }

    const schedule = () => {
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(fit, 120)
    }

    fit()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      dead = true
      if (timer != null) window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [page, loading, numPages, docEpoch])

  // Full-page raster + textLayer (bands slice this when AI/not inserts exist)
  useEffect(() => {
    const doc = docRef.current
    if (!doc || loading) return

    const gen = ++renderGenRef.current
    cancelActiveRender()
    let cancelled = false
    // Invalidate hit-testing until this render finishes (scale/page change)
    setWordGroups([])

    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled || gen !== renderGenRef.current) return

        // Always ≥2× backing store on retina; floor at 2 for crisp type
        const dpr = Math.min(
          Math.max(
            typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
            2,
          ),
          3,
        )
        const cssViewport = pdfPage.getViewport({ scale })
        const outputScale = dpr
        const offscreen = document.createElement('canvas')
        offscreen.width = Math.floor(cssViewport.width * outputScale)
        offscreen.height = Math.floor(cssViewport.height * outputScale)
        const ctx = offscreen.getContext('2d', {
          alpha: false,
          colorSpace: 'srgb',
        } as CanvasRenderingContext2DSettings)
        if (!ctx) throw new Error('Canvas yok')

        // Official pdf.js HiDPI path: CSS viewport + canvas transform
        const transform =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
        const task = pdfPage.render({
          canvasContext: ctx,
          viewport: cssViewport,
          transform,
        } as Parameters<typeof pdfPage.render>[0])
        renderTaskRef.current = task
        await task.promise
        if (cancelled || gen !== renderGenRef.current) return
        renderTaskRef.current = null

        const textContent = await pdfPage.getTextContent()
        if (cancelled || gen !== renderGenRef.current) return

        const groups = buildWordGroups(textContent, cssViewport, scale)
        for (const g of groups) {
          const saved = wordEditsRef.current.get(`${page}:${g.id}`)
          if (saved) g.currentText = saved.currentText
        }
        for (const g of groups) {
          if (g.currentText !== g.str) {
            applyWordEditToCanvas(ctx, g, scale * outputScale)
          }
        }
        if (cancelled || gen !== renderGenRef.current) return
        setWordGroups(groups)

        const measureHost = measureLayerRef.current
        const textLayerDiv = document.createElement('div')
        textLayerDiv.className = 'textLayer pdf-text-layer'
        textLayerDiv.style.width = `${cssViewport.width}px`
        textLayerDiv.style.height = `${cssViewport.height}px`
        if (measureHost) {
          measureHost.innerHTML = ''
          measureHost.style.width = `${cssViewport.width}px`
          measureHost.style.height = `${cssViewport.height}px`
          measureHost.appendChild(textLayerDiv)
        }

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: cssViewport,
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
          width: cssViewport.width,
          height: cssViewport.height,
          pixelRatio: outputScale,
          textHtml: textLayerDiv.innerHTML,
        })
        setPageView({ width: cssViewport.width, height: cssViewport.height })

        // Flat view (no inserts): paint onto visible canvas + live textLayer
        const vis = canvasRef.current
        const liveLayer = textLayerRef.current
        if (vis && liveLayer) {
          paintRasterToCanvas(
            vis,
            offscreen,
            cssViewport.width,
            cssViewport.height,
          )
          liveLayer.innerHTML = textLayerDiv.innerHTML
          liveLayer.className = 'textLayer pdf-text-layer'
          liveLayer.style.width = `${cssViewport.width}px`
          liveLayer.style.height = `${cssViewport.height}px`
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

  /** Paint word edits onto the offscreen raster (and sync visible flat canvas). */
  function paintOnPageCanvas(
    fn: (ctx: CanvasRenderingContext2D) => void,
  ): boolean {
    const target = raster?.canvas || canvasRef.current
    if (!target) return false
    const ctx = target.getContext('2d', { alpha: false })
    if (!ctx) return false
    fn(ctx)
    const vis = canvasRef.current
    if (vis && raster && vis !== target) {
      paintRasterToCanvas(vis, target, raster.width, raster.height)
    }
    if (raster && target === raster.canvas) {
      // New object identity → PdfBand slices redraw
      setRaster({
        canvas: target,
        width: raster.width,
        height: raster.height,
        pixelRatio: raster.pixelRatio,
        textHtml: raster.textHtml,
      })
    }
    return true
  }

  function editPaintScale() {
    return scale * (raster?.pixelRatio || 1)
  }

  /** Open editor; optional transferredText = selection → input (cümle aktarımı). */
  function openWordEditor(
    group: PdfWordGroup,
    opts?: { transferredText?: string; coveredIds?: string[] },
  ) {
    // Always edit original page geometry (not display-shifted coords)
    const orig = originalWordGroup(group.id) || group
    let paperColor = '#ffffff'
    paintOnPageCanvas((ctx) => {
      const s = editPaintScale()
      paperColor = samplePaperNearWord(ctx, orig, s)
      applyWordEditToCanvas(
        ctx,
        { ...orig, currentText: '' },
        s,
        { paperColor, inkColor: '#111' },
      )
    })
    const text =
      opts?.transferredText?.replace(/\s+/g, ' ').trim() || orig.currentText
    setWordDraft({
      group: { ...orig, currentText: text },
      paperColor,
      inkColor: '#111111',
      coveredIds: opts?.coveredIds || [orig.id],
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

    paintOnPageCanvas((ctx) => {
      applyWordEditToCanvas(ctx, group, editPaintScale(), {
        paperColor: draft.paperColor,
        inkColor: draft.inkColor,
      })
    })

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
      displayWordGroups,
      selRect,
      host.getBoundingClientRect(),
    )
    if (!hits.length) return false
    const originals = hits
      .map((h) => originalWordGroup(h.id) || h)
    const span = buildEditSpanFromSelection(originals, selectedText)
    if (!span) return false
    openWordEditor(span, {
      transferredText: selectedText,
      coveredIds: originals.map((h) => h.id),
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

  /** One union box (AI insert anchor). */
  function regionFromSelBands(): PdfRegion | undefined {
    const many = regionsFromSelBands()
    if (!many?.length) return undefined
    if (many.length === 1) return many[0]
    const left = Math.min(...many.map((r) => r.leftPct))
    const top = Math.min(...many.map((r) => r.topPct))
    const right = Math.max(...many.map((r) => r.leftPct + r.widthPct))
    const bottom = Math.max(...many.map((r) => r.topPct + r.heightPct))
    return clampRegion({
      leftPct: left,
      topPct: top,
      widthPct: right - left,
      heightPct: bottom - top,
    })
  }

  /** Per-line boxes — highlight sits on the full sentence, line by line. */
  function regionsFromSelBands(): PdfRegion[] | undefined {
    if (!selBands?.length || !pageView || pageView.width < 1) return undefined
    const ph = pageView.height
    const pw = pageView.width
    return selBands.map((b) => {
      const top = pageYFromDisplay(b.top)
      const bottom = pageYFromDisplay(b.top + b.height)
      // Slight vertical pad so wash covers glyph tops/bottoms
      const pad = Math.max(1.5, (bottom - top) * 0.12) / ph
      return clampRegion({
        leftPct: Math.max(0, (b.left - 2) / pw),
        topPct: Math.max(0, top / ph - pad),
        widthPct: Math.min(1, (b.width + 4) / pw),
        heightPct: Math.min(1, (bottom - top) / ph + pad * 2),
      })
    })
  }

  function fire(action: PdfSelectionAction) {
    const snap = snapshot()
    if (!snap?.selectedText.trim()) return
    const regions = regionsFromSelBands()
    const region =
      regionFromSelBands() ||
      selectionRegion(snap.selectedText) ||
      regionFromSnap(snap.rect, pageHostRef.current, pageView)
    let paperColor: string | undefined
    try {
      const src = raster?.canvas || canvasRef.current
      const cctx = src?.getContext('2d')
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
      regions,
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
      if (!host || !bytesRef.current) {
        onAction?.(payload, action)
        clearSelection()
        return
      }
      const box = host.getBoundingClientRect()
      const hitIds = new Set(
        displayWordGroups
          .filter((g) => {
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
          .map((g) => g.id),
      )
      const hits = wordGroups.filter((g) => hitIds.has(g.id))
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
      }
      paintOnPageCanvas((ctx) => {
        const s = editPaintScale()
        for (const g of redacted) {
          applyWordEditToCanvas(ctx, g, s, {
            paperColor: '#111111',
            inkColor: '#111111',
          })
        }
      })
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
    const barW = 420
    const barH = 72
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

  const flowInserts = flowInsertsEarly

  const segments = useMemo(() => {
    if (!raster) return []
    return buildPageSegments(raster.height, flowInserts)
  }, [raster, flowInserts])

  // Flat canvas when no in-flow inserts
  useEffect(() => {
    if (hasFlowInserts || !raster) return
    const vis = canvasRef.current
    const liveLayer = textLayerRef.current
    if (!vis || !liveLayer) return
    paintRasterToCanvas(vis, raster.canvas, raster.width, raster.height)
    liveLayer.innerHTML = raster.textHtml
    liveLayer.className = 'textLayer pdf-text-layer'
    liveLayer.style.width = `${raster.width}px`
    liveLayer.style.height = `${raster.height}px`
  }, [hasFlowInserts, raster])

  // Measure in-flow insert heights → remap word hit Y
  useEffect(() => {
    if (!hasFlowInserts) {
      setInsertHeights((prev) => (Object.keys(prev).length ? {} : prev))
      return
    }
    const host = pageHostRef.current
    if (!host) return
    const measure = () => {
      const next: Record<string, number> = {}
      host.querySelectorAll<HTMLElement>('[data-insert-slot]').forEach((node) => {
        const id = node.dataset.insertSlot
        if (id) next[id] = node.offsetHeight
      })
      setInsertHeights((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
        for (const k of keys) {
          if ((prev[k] || 0) !== (next[k] || 0)) return next
        }
        return prev
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    host.querySelectorAll('[data-insert-slot]').forEach((n) => ro.observe(n))
    return () => ro.disconnect()
  }, [hasFlowInserts, segments, page])

  // Notes list → jump + flash region
  useEffect(() => {
    if (!focusTarget) return
    if (focusTarget.page !== page) {
      setPage(focusTarget.page)
      return
    }
    setFlashRegion(focusTarget.region ?? null)
    const t = window.setTimeout(() => {
      setFlashRegion(null)
      onFocusHandled?.()
    }, 2200)
    const host = pageHostRef.current
    if (host && focusTarget.region) {
      const y =
        focusTarget.region.topPct * (pageView?.height || host.clientHeight)
      wrapRef.current?.scrollTo({
        top: Math.max(0, host.offsetTop + y - 48),
        behavior: 'smooth',
      })
    } else {
      wrapRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, page, pageView?.height])

  useEffect(() => {
    if (!searchOpen) return
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [searchOpen])

  useEffect(() => {
    if (hideChrome) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hideChrome])

  async function runSearch(q: string) {
    const doc = docRef.current
    if (!doc) return
    searchAbortRef.current?.abort()
    const ac = new AbortController()
    searchAbortRef.current = ac
    setSearchBusy(true)
    try {
      const hits = await searchPdfDocument(doc, q, { signal: ac.signal })
      if (ac.signal.aborted) return
      setSearchHits(hits)
      setSearchIdx(0)
      if (hits[0]) setPage(hits[0].page)
    } catch {
      if (!ac.signal.aborted) setSearchHits([])
    } finally {
      if (!ac.signal.aborted) setSearchBusy(false)
    }
  }

  function goSearchHit(delta: number) {
    if (!searchHits.length) return
    const next =
      (searchIdx + delta + searchHits.length) % searchHits.length
    setSearchIdx(next)
    setPage(searchHits[next].page)
  }

  const regionMarks = useMemo(() => {
    const list: Array<{
      id: string
      kind: string
      region: PdfRegion
      flash?: boolean
    }> = []
    for (const a of annotations) {
      if (a.page !== page) continue
      // Notes / AI / bookmarks never paint over book text — margin rail instead
      if (
        a.kind !== 'highlight' &&
        a.kind !== 'underline' &&
        a.kind !== 'strike' &&
        a.kind !== 'omit'
      ) {
        continue
      }
      const boxes =
        a.regions && a.regions.length > 0
          ? a.regions
          : a.region
            ? [a.region]
            : []
      boxes.forEach((region, i) => {
        list.push({ id: `${a.id}:${i}`, kind: a.kind, region })
      })
    }
    if (flashRegion) {
      list.push({
        id: '__flash',
        kind: 'flash',
        region: flashRegion,
        flash: true,
      })
    }
    return list
  }, [annotations, page, flashRegion])

  const marginNotes = useMemo(() => {
    return annotations.filter((a) => a.page === page && isMarginNote(a))
  }, [annotations, page])

  const activeSearchHit = searchHits[searchIdx] ?? null

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
            className={`btn-ghost text-xs${searchOpen ? ' is-active' : ''}`}
            aria-pressed={searchOpen}
            title="PDF içinde ara"
            onClick={() => {
              setSearchOpen((v) => !v)
              if (searchOpen) {
                setSearchHits([])
                setSearchQuery('')
              }
            }}
          >
            Ara
          </button>
          <button
            type="button"
            className={`btn-ghost text-xs${areaMode ? ' is-active' : ''}`}
            aria-pressed={areaMode}
            disabled={hasFlowInserts || editBusy}
            title={
              hasFlowInserts
                ? 'Alan seçimi: ekli sayfada düz görünüm gerekir'
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
            onClick={() => {
              userScaleLockRef.current = true
              setScale((s) => Math.max(0.7, +(s - 0.1).toFixed(2)))
            }}
          >
            −
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              userScaleLockRef.current = true
              setScale((s) => Math.min(2.6, +(s + 0.1).toFixed(2)))
            }}
          >
            +
          </button>
        </div>
      ) : null}

      {searchOpen && !hideChrome ? (
        <div className="pdf-search-bar" data-selection-toolbar>
          <input
            ref={searchInputRef}
            className="pdf-search-bar__input"
            type="search"
            placeholder="PDF’de ara…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) goSearchHit(-1)
                else if (searchHits.length && searchQuery.trim().length >= 2)
                  goSearchHit(1)
                else void runSearch(searchQuery)
              }
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setSearchHits([])
              }
            }}
          />
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={searchBusy || searchQuery.trim().length < 2}
            onClick={() => void runSearch(searchQuery)}
          >
            {searchBusy ? '…' : 'Bul'}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={!searchHits.length}
            onClick={() => goSearchHit(-1)}
            aria-label="Önceki"
          >
            ‹
          </button>
          <span className="pdf-search-bar__count muted">
            {searchHits.length
              ? `${searchIdx + 1}/${searchHits.length}`
              : searchBusy
                ? 'aranıyor'
                : '—'}
          </span>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={!searchHits.length}
            onClick={() => goSearchHit(1)}
            aria-label="Sonraki"
          >
            ›
          </button>
          {activeSearchHit ? (
            <p className="pdf-search-bar__snippet" title={activeSearchHit.snippet}>
              s.{activeSearchHit.page}: {activeSearchHit.snippet}
            </p>
          ) : null}
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
            className={`pdf-page-row${marginNotes.length ? ' pdf-page-row--with-margin' : ''}`}
          >
          <div className="pdf-page-stack">
          <div
            ref={pageHostRef}
            className={
              [
                hasFlowInserts
                  ? 'pdf-page-host pdf-page-host--composed'
                  : 'pdf-page-host',
                areaMode ? 'pdf-page-host--area-select' : '',
                wordSelectMode ? 'pdf-page-host--word-select' : '',
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
              if (areaMode || wordSelectMode) return
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
                displayWordGroups,
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
              if (areaMode || wordDraft || editBusy) return
              if ((e.target as HTMLElement).closest('[data-insert-slot]')) return
              const host = pageHostRef.current
              if (!host) return
              const hit = findWordGroupAt(
                displayWordGroups,
                e.clientX,
                e.clientY,
                host.getBoundingClientRect(),
              )
              if (hit) {
                e.preventDefault()
                e.stopPropagation()
                clearSelection()
                openWordEditor(originalWordGroup(hit.id) || hit)
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
                  const ann = seg.insert.annotation
                  if (!ann) return null
                  return (
                    <div
                      key={seg.key}
                      data-insert-slot={ann.id}
                      className="pdf-insert-slot"
                    >
                      <PdfInsertBlock
                        annotation={ann}
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
                    </div>
                  )
                })
              : (
                <>
                  <canvas ref={canvasRef} className="pdf-page-canvas" />
                  <div ref={textLayerRef} className="textLayer pdf-text-layer" />
                </>
              )}

            <div
              ref={wordHitsRef}
              className={`pdf-word-hits${hasFlowInserts ? ' pdf-word-hits--composed' : ''}`}
              aria-hidden
            >
              {!wordDraft &&
                displayWordGroups.map((g) => (
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
                    title={`${g.currentText} — çift tık: düzenle · sürükle: seç · üç tık: satır`}
                  />
                ))}
            </div>
            {selBands && selBands.length > 0 ? (
              <div className="pdf-sel-bands" aria-hidden>
                {selBands.map((b, i) => (
                  <div
                    key={`band-${i}`}
                    className="pdf-sel-band"
                    style={{
                      left: b.left,
                      top: b.top,
                      width: b.width,
                      height: b.height,
                    }}
                  />
                ))}
              </div>
            ) : null}
            {wordDraft ? (
              <input
                ref={wordInputRef}
                className="pdf-word-edit"
                type="text"
                value={wordDraftText}
                data-selection-toolbar
                style={{
                  left: Math.max(0, wordDraft.group.left - 2),
                  top: Math.max(
                    0,
                    wordDraft.group.top +
                      spaceAbovePageY(wordDraft.group.top) -
                      3,
                  ),
                  width: Math.max(
                    wordDraft.group.width + 48,
                    Math.min(
                      pageView?.width || raster?.width || 400,
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

          {/* Outside pageHost so highlight DOM never steals pointer hit-testing */}
          {regionMarks.length > 0 && (pageView || raster) ? (
            <div
              className="pdf-region-marks"
              aria-hidden
              style={
                !hasFlowInserts && pageView
                  ? { width: pageView.width, height: pageView.height }
                  : raster
                    ? { width: raster.width, minHeight: raster.height }
                    : undefined
              }
            >
              {regionMarks.map((m) => {
                const pageW = pageView?.width || raster!.width
                const pageH = pageView?.height || raster!.height
                const top0 = m.region.topPct * pageH
                const top =
                  top0 + (hasFlowInserts ? spaceAbovePageY(top0) : 0)
                return (
                  <div
                    key={m.id}
                    className={`pdf-region-mark pdf-region-mark--${m.kind}${
                      m.flash ? ' is-flash' : ''
                    }`}
                    style={{
                      left: m.region.leftPct * pageW,
                      top,
                      width: m.region.widthPct * pageW,
                      height: m.region.heightPct * pageH,
                    }}
                  />
                )
              })}
            </div>
          ) : null}
          </div>

          {marginNotes.length > 0 && (pageView || raster) ? (
            <div
              className="pdf-margin-rail"
              style={{
                minHeight: !hasFlowInserts
                  ? pageView?.height || raster?.height
                  : undefined,
              }}
            >
              {marginNotes.map((a) => {
                const pageH = pageView?.height || raster!.height
                const y0 =
                  typeof a.anchorTopPct === 'number'
                    ? a.anchorTopPct * pageH
                    : a.region
                      ? a.region.topPct * pageH
                      : pageH * 0.4
                const top = Math.max(
                  0,
                  y0 + (hasFlowInserts ? spaceAbovePageY(y0) : 0) - 4,
                )
                const body = (a.body || '').trim()
                const text = body || `“${a.quote.slice(0, 72)}${a.quote.length > 72 ? '…' : ''}”`
                return (
                  <aside
                    key={a.id}
                    className={`pdf-margin-note${a.kind === 'bookmark' ? ' pdf-margin-note--bookmark' : ''}`}
                    style={{ top }}
                    data-selection-toolbar
                  >
                    <p className="pdf-margin-note__label">
                      {a.kind === 'bookmark' ? 'Yer imi' : 'Not'}
                    </p>
                    <p className="pdf-margin-note__body">{text}</p>
                    {bookId && onAnnotationsChange ? (
                      <button
                        type="button"
                        className="pdf-margin-note__remove"
                        onClick={() => {
                          removePdfAnnotation(bookId, a.id)
                          onAnnotationsChange()
                        }}
                      >
                        Kaldır
                      </button>
                    ) : null}
                  </aside>
                )
              })}
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
  // Prefer region-band paint for highlights (continuous sentence wash) — skip double paint
  const geoHighlightQuotes = new Set(
    opts.annotations
      .filter(
        (a) =>
          a.page === page &&
          a.kind === 'highlight' &&
          !!(a.region || (a.regions && a.regions.length)),
      )
      .map((a) => a.quote),
  )
  markTextLayer(
    layer,
    opts.highlightedQuotes.filter((q) => !geoHighlightQuotes.has(q)),
    'is-highlighted',
  )
  markTextLayer(layer, opts.underlinedQuotes, 'is-underlined')
  markTextLayer(layer, opts.struckQuotes, 'is-struck')
  markTextLayer(layer, opts.redactedQuotes, 'is-redacted')
  for (const a of opts.annotations) {
    if (a.page !== page) continue
    if (a.kind === 'highlight') {
      if (a.region || (a.regions && a.regions.length)) continue
      markTextLayer(layer, [a.quote], 'is-highlighted')
    } else if (a.kind === 'underline')
      markTextLayer(layer, [a.quote], 'is-underlined')
    else if (a.kind === 'strike') markTextLayer(layer, [a.quote], 'is-struck')
  }
}

/** Draw HiDPI raster into a display canvas (CSS size ≠ backing store). */
function paintRasterToCanvas(
  vis: HTMLCanvasElement,
  source: HTMLCanvasElement,
  cssW: number,
  cssH: number,
) {
  vis.width = source.width
  vis.height = source.height
  // Explicit CSS size — must win over stylesheet height:auto
  vis.style.setProperty('width', `${cssW}px`, 'important')
  vis.style.setProperty('height', `${cssH}px`, 'important')
  vis.style.setProperty('max-width', 'none', 'important')
  const vctx = vis.getContext('2d', { alpha: false })
  if (!vctx) return
  vctx.imageSmoothingEnabled = false
  vctx.drawImage(source, 0, 0)
}

/** One vertical slice of the full-page raster + clipped textLayer (reading). */
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
  const textRef = useRef<HTMLDivElement>(null)
  const pr = raster.pixelRatio || 1

  useEffect(() => {
    const c = canvasRef.current
    if (!c || height < 1) return
    const srcTopPx = srcTop * pr
    const heightPx = Math.max(1, Math.round(height * pr))
    c.width = raster.canvas.width
    c.height = heightPx
    c.style.setProperty('width', `${raster.width}px`, 'important')
    c.style.setProperty('height', `${Math.max(1, height)}px`, 'important')
    c.style.setProperty('max-width', 'none', 'important')
    const ctx = c.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      raster.canvas,
      0,
      srcTopPx,
      raster.canvas.width,
      heightPx,
      0,
      0,
      c.width,
      heightPx,
    )
  }, [raster, srcTop, height, pr])

  useEffect(() => {
    const layer = textRef.current
    if (!layer) return
    layer.innerHTML = raster.textHtml
    layer.className = 'textLayer pdf-text-layer pdf-band__text'
    layer.style.width = `${raster.width}px`
    layer.style.height = `${raster.height}px`
    layer.style.top = `${-srcTop}px`
  }, [raster, srcTop])

  return (
    <div
      className="pdf-band"
      style={{ width: raster.width, height: Math.max(1, height) }}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" aria-hidden />
      <div ref={textRef} className="textLayer pdf-text-layer pdf-band__text" />
    </div>
  )
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
