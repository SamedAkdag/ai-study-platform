import { useEffect, useRef, useState } from 'react'
import { pdfjsLib, ensurePdfWorker } from '@/lib/pdfjs'
import { useTextSelection } from '@/hooks/useTextSelection'
import type {
  PdfSelectionAction,
  PdfSelectionPayload,
} from '@/types/pdfSelection'
import PageJumpControl from '@/components/PageJumpControl'
import SelectionActionBar from '@/components/SelectionActionBar'
import PdfInlineLayer, { type InlineDraft } from '@/components/PdfInlineLayer'
import {
  addPdfAnnotation,
  removePdfAnnotation,
  type PdfAnnotation,
  type PdfAiMode,
} from '@/lib/pdfAnnotations'
import { normQuote } from '@/lib/pdfQuoteAnchor'

export type { PdfSelectionAction, PdfSelectionPayload }

type Props = {
  src: string
  startPage?: number
  endPage?: number
  page?: number
  onPageChange?: (page: number) => void
  omittedQuotes?: string[]
  highlightedQuotes?: string[]
  /** Saved marks / AI / notes for this book (viewer filters by page) */
  annotations?: PdfAnnotation[]
  bookId?: string
  chapterId?: string
  chapterTitle?: string
  onAnnotationsChange?: () => void
  onAction?: (payload: PdfSelectionPayload, action: PdfSelectionAction) => void
  className?: string
  hideChrome?: boolean
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
  const renderMountRef = useRef<HTMLDivElement>(null)
  const [pageHostEl, setPageHostEl] = useState<HTMLElement | null>(null)
  const [pageInternal, setPageInternal] = useState(pageProp ?? startPage)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.15)
  const [draft, setDraft] = useState<InlineDraft | null>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  const controlled = typeof pageProp === 'number'
  const page = controlled ? pageProp : pageInternal
  const canInline = !!(bookId && chapterId)

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

  useEffect(() => {
    const host = renderMountRef.current
    const doc = docRef.current
    if (!host || !doc || loading) return

    let cancelled = false

    void (async () => {
      host.innerHTML = ''
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return

        const viewport = pdfPage.getViewport({ scale })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas yok')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.className = 'pdf-page-canvas'
        host.appendChild(canvas)
        await pdfPage.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return

        const textLayerDiv = document.createElement('div')
        textLayerDiv.className = 'textLayer pdf-text-layer'
        textLayerDiv.style.width = `${viewport.width}px`
        textLayerDiv.style.height = `${viewport.height}px`
        host.appendChild(textLayerDiv)

        const textContent = await pdfPage.getTextContent()
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sayfa çizilemedi')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [page, scale, loading, numPages])

  useEffect(() => {
    const host = renderMountRef.current
    if (!host || loading) return
    const layer = host.querySelector('.textLayer') as HTMLElement | null
    if (!layer) return
    layer
      .querySelectorAll('span.is-highlighted, span.is-omitted')
      .forEach((el) => {
        el.classList.remove('is-highlighted', 'is-omitted')
      })
    markTextLayer(layer, omittedQuotes, 'is-omitted')
    markTextLayer(layer, highlightedQuotes, 'is-highlighted')
  }, [page, scale, loading, numPages, omittedQuotes, highlightedQuotes])

  function selectionAnchor(snap: {
    rect: DOMRect
  }): { top: number; left: number } {
    const host = pageHostRef.current
    if (!host) return { top: 48, left: 16 }
    const box = host.getBoundingClientRect()
    return {
      top: Math.max(8, snap.rect.bottom - box.top + 8),
      left: Math.max(8, snap.rect.left - box.left),
    }
  }

  function pctFromPx(top: number, left: number) {
    const host = pageHostRef.current
    const h = Math.max(host?.clientHeight || 1, 1)
    const w = Math.max(host?.clientWidth || 1, 1)
    return {
      anchorTopPct: top / h,
      anchorLeftPct: left / w,
    }
  }

  function fire(action: PdfSelectionAction) {
    const snap = snapshot()
    if (!snap?.selectedText.trim()) return
    const payload: PdfSelectionPayload = {
      selectedText: snap.selectedText,
      precedingContext: snap.precedingContext,
      followingContext: snap.followingContext,
      page,
    }

    const inlineAi =
      canInline &&
      (action === 'ask' || action === 'summarize' || action === 'explain')
    const inlineNote = canInline && action === 'note'

    if (inlineAi || inlineNote) {
      const { top, left } = selectionAnchor(snap)
      setDraft(
        inlineNote
          ? { kind: 'note', payload, top, left }
          : {
              kind: 'ai',
              mode: action as PdfAiMode,
              payload,
              top,
              left,
            },
      )
      clearSelection()
      return
    }

    onAction?.(payload, action)
    clearSelection()
  }

  const toolbarStyle = (() => {
    if (!selection) return undefined
    const gap = 10
    const barW = 300
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
    return {
      position: 'fixed' as const,
      top,
      left,
      zIndex: 90,
    }
  })()

  const showToolbar = !!selection && (!!onAction || canInline)

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
        <div
          ref={(el) => {
            pageHostRef.current = el
            setPageHostEl(el)
          }}
          className="pdf-page-host"
        >
          <div ref={renderMountRef} className="pdf-page-render" />
          {canInline && chapterId && chapterTitle && bookId ? (
            <PdfInlineLayer
              pageHost={pageHostEl}
              page={page}
              annotations={annotations}
              draft={draft}
              chapterId={chapterId}
              chapterTitle={chapterTitle}
              onDraftClose={() => setDraft(null)}
              onSaveAi={({ payload, mode, question, body, top, left }) => {
                const pct = pctFromPx(top, left)
                addPdfAnnotation(bookId, {
                  page: payload.page,
                  kind: 'ai',
                  aiMode: mode,
                  quote: payload.selectedText,
                  question,
                  body,
                  ...pct,
                })
                setDraft(null)
                onAnnotationsChange?.()
              }}
              onSaveNote={({ payload, body, top, left }) => {
                const pct = pctFromPx(top, left)
                addPdfAnnotation(bookId, {
                  page: payload.page,
                  kind: 'note',
                  quote: payload.selectedText,
                  body,
                  ...pct,
                })
                setDraft(null)
                onAnnotationsChange?.()
              }}
              onRemove={(id) => {
                removePdfAnnotation(bookId, id)
                onAnnotationsChange?.()
              }}
            />
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
      </div>
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
