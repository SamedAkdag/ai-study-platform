import { useEffect, useRef, useState } from 'react'
import { pdfjsLib, ensurePdfWorker } from '@/lib/pdfjs'
import {
  preserveSelectionOnPointerDown,
  useTextSelection,
} from '@/hooks/useTextSelection'
import type {
  PdfSelectionAction,
  PdfSelectionPayload,
} from '@/types/pdfSelection'
import PageJumpControl from '@/components/PageJumpControl'

export type { PdfSelectionAction, PdfSelectionPayload }

type Props = {
  src: string
  startPage?: number
  endPage?: number
  /** Kontrollü sayfa (Studium ↔ orijinal geçişinde kalır) */
  page?: number
  onPageChange?: (page: number) => void
  /** Hidden / omitted quote snippets on this page (strikethrough overlay) */
  omittedQuotes?: string[]
  highlightedQuotes?: string[]
  onAction?: (payload: PdfSelectionPayload, action: PdfSelectionAction) => void
  className?: string
  /** Üst chrome gizle (içeride gömülü kullanım) */
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
  onAction,
  className = '',
  hideChrome = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pageHostRef = useRef<HTMLDivElement>(null)
  const [pageInternal, setPageInternal] = useState(pageProp ?? startPage)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.15)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  const controlled = typeof pageProp === 'number'
  const page = controlled ? pageProp : pageInternal

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
  // numPages henüz 0 iken max=1 yapma — Studium↔PDF geçişinde sayfayı 1'e düşürür
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
    // PDF metadata gelmeden sıkıştırma — aksi halde mevcut sayfa 1 olur
    if (numPages <= 0 && !endPage) return
    const hi = endPage
      ? Math.min(endPage, numPages > 0 ? numPages : endPage)
      : numPages
    if (hi <= 0) return
    const clamped = Math.min(Math.max(pageProp, minPage), hi)
    if (clamped !== pageProp) onPageChange?.(clamped)
  }, [controlled, pageProp, minPage, numPages, endPage, onPageChange])

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
    // page bilerek dependency değil — sadece src değişince yeniden yükle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startPage, endPage])

  useEffect(() => {
    const host = pageHostRef.current
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

        // Visual mark omitted / highlighted spans in text layer
        if (!cancelled) {
          markTextLayer(textLayerDiv, omittedQuotes, 'is-omitted')
          markTextLayer(textLayerDiv, highlightedQuotes, 'is-highlighted')
        }
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

  function fire(action: PdfSelectionAction) {
    const snap = snapshot()
    if (!snap?.selectedText.trim() || !onAction) return
    onAction(
      {
        selectedText: snap.selectedText,
        precedingContext: snap.precedingContext,
        followingContext: snap.followingContext,
        page,
      },
      action,
    )
    clearSelection()
  }

  const toolbar =
    selection && onAction ? (
      <div
        data-selection-toolbar
        className="selection-action-bar selection-action-bar--float pdf-selection-bar"
        style={{
          position: 'absolute',
          top: Math.max(
            8,
            selection.rect.bottom -
              (wrapRef.current?.getBoundingClientRect().top ?? 0) +
              (wrapRef.current?.scrollTop ?? 0) +
              6,
          ),
          left: Math.max(
            8,
            selection.rect.left -
              (wrapRef.current?.getBoundingClientRect().left ?? 0) +
              (wrapRef.current?.scrollLeft ?? 0),
          ),
          zIndex: 30,
        }}
      >
        <p className="selection-action-bar__preview">
          {selection.selectedText.slice(0, 80)}
          {selection.selectedText.length > 80 ? '…' : ''}
        </p>
        <div className="selection-action-bar__actions">
          <button
            type="button"
            className="chip chip-active"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('summarize')
            }}
          >
            Özetle
          </button>
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('ask')
            }}
          >
            AI’ya sor
          </button>
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('cite')
            }}
          >
            Cite
          </button>
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('note')
            }}
          >
            Benim notum
          </button>
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('highlight')
            }}
          >
            Vurgula
          </button>
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('omit')
            }}
          >
            Çıkar
          </button>
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              hold()
              fire('extract')
            }}
          >
            Alıntıla
          </button>
        </div>
      </div>
    ) : null

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
        <div ref={pageHostRef} className="pdf-page-host" />
        {toolbar}
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
  const spans = [...layer.querySelectorAll('span')]
  const full = spans.map((s) => s.textContent || '').join('')
  const normFull = full.replace(/\s+/g, ' ')

  for (const quote of quotes) {
    const q = quote.replace(/\s+/g, ' ').trim()
    if (q.length < 4) continue
    const idx = normFull.indexOf(q.slice(0, Math.min(40, q.length)))
    if (idx < 0) continue
    // Approximate: mark all spans that appear to overlap by walking char offsets
    let cursor = 0
    for (const span of spans) {
      const t = (span.textContent || '').replace(/\s+/g, ' ')
      const start = cursor
      const end = cursor + t.length
      cursor = end
      if (end > idx && start < idx + q.length) {
        span.classList.add(className)
      }
    }
  }
}
