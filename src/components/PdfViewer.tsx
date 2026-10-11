import { useEffect, useMemo, useRef, useState } from 'react'
import { pdfjsLib, ensurePdfWorker } from '@/lib/pdfjs'
import { useTextSelection } from '@/hooks/useTextSelection'
import type {
  PdfSelectionAction,
  PdfSelectionPayload,
} from '@/types/pdfSelection'
import PageJumpControl from '@/components/PageJumpControl'
import SelectionActionBar from '@/components/SelectionActionBar'
import PdfInsertBlock, { type InsertDraft } from '@/components/PdfInsertBlock'
import {
  addPdfAnnotation,
  removePdfAnnotation,
  type PdfAnnotation,
  type PdfAiMode,
} from '@/lib/pdfAnnotations'
import { findQuoteAnchor, normQuote } from '@/lib/pdfQuoteAnchor'
import {
  buildPageSegments,
  isFlowInsert,
  resolveInsertY,
  type PageInsert,
} from '@/lib/pdfInserts'

export type { PdfSelectionAction, PdfSelectionPayload }

type Props = {
  src: string
  startPage?: number
  endPage?: number
  page?: number
  onPageChange?: (page: number) => void
  omittedQuotes?: string[]
  highlightedQuotes?: string[]
  annotations?: PdfAnnotation[]
  bookId?: string
  chapterId?: string
  chapterTitle?: string
  onAnnotationsChange?: () => void
  onAction?: (payload: PdfSelectionPayload, action: PdfSelectionAction) => void
  className?: string
  hideChrome?: boolean
}

type PageRaster = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** Serialized text layer HTML for cloning into bands */
  textHtml: string
}

export default function PdfViewer({
  src,
  startPage = 1,
  endPage,
  page: pageProp,
  onPageChange,
  omittedQuotes = [],
  highlightedQuotes = [],
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
  const measureLayerRef = useRef<HTMLDivElement>(null)
  const [pageInternal, setPageInternal] = useState(pageProp ?? startPage)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.15)
  const [draft, setDraft] = useState<InsertDraft | null>(null)
  const [raster, setRaster] = useState<PageRaster | null>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  const controlled = typeof pageProp === 'number'
  const page = controlled ? pageProp : pageInternal
  const canInsert = !!(bookId && chapterId)

  function setPage(next: number | ((p: number) => number)) {
    const raw = typeof next === 'function' ? next(page) : next
    const hi =
      numPages > 0 || endPage
        ? endPage
          ? Math.min(endPage, numPages > 0 ? numPages : endPage)
          : numPages
        : Math.max(raw, minPage)
    const value = Math.min(Math.max(raw, minPage), Math.max(minPage, hi))
    if (!controlled) setPageInternal(value)
    onPageChange?.(value)
  }

  const { ctx: selection, clear: clearSelection, hold, snapshot } =
    useTextSelection(pageHostRef)

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

  useEffect(() => {
    setDraft(null)
  }, [page])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        await ensurePdfWorker()
        docRef.current?.destroy().catch(() => undefined)
        docRef.current = null

        const res = await fetch(src)
        if (!res.ok) throw new Error(`PDF alınamadı (${res.status})`)
        const data = new Uint8Array(await res.arrayBuffer())
        const doc = await pdfjsLib.getDocument({ data }).promise
        if (cancelled) {
          await doc.destroy()
          return
        }
        docRef.current = doc
        setNumPages(doc.numPages)
        const hi = endPage ? Math.min(endPage, doc.numPages) : doc.numPages
        const lo = Math.min(startPage, hi)
        const next = Math.min(Math.max(page, lo), hi)
        if (!controlled) setPageInternal(next)
        else if (next !== page) onPageChange?.(next)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF açılamadı')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      docRef.current?.destroy().catch(() => undefined)
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startPage, endPage])

  // Rasterize full page + text layer HTML once per page/scale
  useEffect(() => {
    const doc = docRef.current
    if (!doc || loading) return
    let cancelled = false

    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const viewport = pdfPage.getViewport({ scale })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas yok')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await pdfPage.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return

        const textLayerDiv = document.createElement('div')
        textLayerDiv.className = 'textLayer pdf-text-layer'
        textLayerDiv.style.width = `${viewport.width}px`
        textLayerDiv.style.height = `${viewport.height}px`
        // Off-DOM measure host for quote Y + HTML snapshot
        const mount = measureLayerRef.current
        if (mount) {
          mount.innerHTML = ''
          mount.style.width = `${viewport.width}px`
          mount.style.height = `${viewport.height}px`
          mount.appendChild(textLayerDiv)
        }

        const textContent = await pdfPage.getTextContent()
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
        if (cancelled) return

        markTextLayer(textLayerDiv, omittedQuotes, 'is-omitted')
        markTextLayer(textLayerDiv, highlightedQuotes, 'is-highlighted')

        setRaster({
          canvas,
          width: viewport.width,
          height: viewport.height,
          textHtml: textLayerDiv.innerHTML,
        })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sayfa çizilemedi')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [page, scale, loading, numPages, omittedQuotes, highlightedQuotes])

  const pageInserts: PageInsert[] = useMemo(() => {
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

    if (draft) {
      list.push({
        id: '__draft__',
        y: draft.y,
        draft: true,
      })
    }

    return list
  }, [annotations, page, raster, draft])

  const segments = useMemo(() => {
    if (!raster) return []
    return buildPageSegments(raster.height, pageInserts)
  }, [raster, pageInserts])

  function fire(action: PdfSelectionAction) {
    const snap = snapshot()
    if (!snap?.selectedText.trim()) return
    const payload: PdfSelectionPayload = {
      selectedText: snap.selectedText,
      precedingContext: snap.precedingContext,
      followingContext: snap.followingContext,
      page,
    }

    const openInsert =
      canInsert &&
      (action === 'ask' ||
        action === 'summarize' ||
        action === 'explain' ||
        action === 'note')

    if (openInsert && raster) {
      const layer = measureLayerRef.current?.querySelector(
        '.textLayer',
      ) as HTMLElement | null
      const host = pageHostRef.current
      let y = raster.height * 0.4
      if (layer) {
        const anchor = findQuoteAnchor(layer, payload.selectedText)
        if (anchor) y = anchor.bottom
      } else if (host) {
        const box = host.getBoundingClientRect()
        // Fallback: map viewport selection into first band space — approximate
        y = Math.min(
          raster.height - 1,
          Math.max(1, snap.rect.bottom - box.top),
        )
      }
      setDraft(
        action === 'note'
          ? { kind: 'note', payload, y }
          : { kind: 'ai', mode: action as PdfAiMode, payload, y },
      )
      clearSelection()
      // Scroll insert into view shortly after layout
      window.setTimeout(() => {
        document
          .querySelector('.pdf-insert--draft')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 80)
      return
    }

    onAction?.(payload, action)
    clearSelection()
  }

  const toolbarStyle = (() => {
    if (!selection) return undefined
    const gap = 10
    const barW = 320
    const barH = 78
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    let top = selection.rect.bottom + gap
    if (top + barH > vh - 12) {
      top = Math.max(12, selection.rect.top - barH - gap)
    }
    const left = Math.min(
      Math.max(8, selection.rect.left),
      Math.max(8, vw - barW - 8),
    )
    return { position: 'fixed' as const, top, left, zIndex: 90 }
  })()

  const showToolbar = !!selection && (!!onAction || canInsert)

  return (
    <div className={`pdf-viewer ${className}`}>
      {!hideChrome ? (
        <div className="pdf-viewer__chrome">
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

      <div ref={wrapRef} className="pdf-viewer__scroll">
        {loading && <p className="muted p-4 text-sm">PDF yükleniyor…</p>}
        {error && <div className="alert-error m-3">{error}</div>}

        {/* Hidden measure layer for quote geometry */}
        <div
          ref={measureLayerRef}
          className="pdf-measure-layer"
          aria-hidden
        />

        <div ref={pageHostRef} className="pdf-page-host pdf-page-host--composed">
          {raster &&
            segments.map((seg) => {
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
              const annotation = insert.annotation
              const isDraft = insert.draft && draft
              return (
                <PdfInsertBlock
                  key={seg.key}
                  annotation={annotation}
                  draft={isDraft ? draft : undefined}
                  chapterId={chapterId || ''}
                  chapterTitle={chapterTitle || 'PDF'}
                  onDismissDraft={() => setDraft(null)}
                  onCommitAi={({ payload, mode, question, body, y }) => {
                    if (!bookId) return
                    const h = raster.height || 1
                    addPdfAnnotation(bookId, {
                      page: payload.page,
                      kind: 'ai',
                      aiMode: mode,
                      quote: payload.selectedText,
                      question,
                      body,
                      anchorTopPct: y / h,
                      anchorLeftPct: 0.06,
                    })
                    setDraft(null)
                    onAnnotationsChange?.()
                  }}
                  onCommitNote={({ payload, body, y }) => {
                    if (!bookId) return
                    const h = raster.height || 1
                    addPdfAnnotation(bookId, {
                      page: payload.page,
                      kind: 'note',
                      quote: payload.selectedText,
                      body,
                      anchorTopPct: y / h,
                      anchorLeftPct: 0.06,
                    })
                    setDraft(null)
                    onAnnotationsChange?.()
                  }}
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
            })}
        </div>

        {showToolbar ? (
          <SelectionActionBar
            preview={selection!.selectedText}
            hold={hold}
            onAction={fire}
            style={toolbarStyle}
          />
        ) : null}
      </div>
    </div>
  )
}

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
