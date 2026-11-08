import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { preserveSelectionOnPointerDown } from '@/hooks/useTextSelection'
import type { PdfSelectionAction } from '@/types/pdfSelection'

type Props = {
  preview: string
  style?: CSSProperties
  onAction: (action: PdfSelectionAction) => void
  hold?: () => void
  /** Region marquee (chart/figure) — AI-first actions, no text replace. */
  variant?: 'text' | 'region'
  /** After double-click paragraph — emphasize Ask (kept for callers). */
  emphasizeAsk?: boolean
}

type MoreItem = { action: PdfSelectionAction; label: string }

const TEXT_MORE: MoreItem[] = [
  { action: 'listen', label: 'Sesli oku' },
  { action: 'translate', label: 'Çevir' },
  { action: 'mindmap', label: 'Zihin haritası' },
  { action: 'note', label: 'Not al' },
  { action: 'highlight', label: 'Vurgu' },
  { action: 'cite', label: 'Cite' },
  { action: 'copy', label: 'Kopyala' },
  { action: 'bookmark', label: 'Yer imi' },
  { action: 'underline', label: 'Altını çiz' },
  { action: 'strike', label: 'Üstünü çiz' },
  { action: 'omit', label: 'Metni gizle' },
  { action: 'replace', label: 'Değiştir' },
  { action: 'redact', label: 'Sansür' },
]

/**
 * Floats under a PDF selection — Ask first, then a few tools + ⋯.
 */
export default function SelectionActionBar({
  preview,
  style,
  onAction,
  hold,
  variant = 'text',
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isRegion = variant === 'region'

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  useLayoutEffect(() => {
    if (!moreOpen || !moreBtnRef.current) {
      setPanelPos(null)
      return
    }
    const place = () => {
      const btn = moreBtnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const gap = 6
      const panelW = Math.min(288, window.innerWidth - 16)
      const maxH = Math.min(220, Math.floor(window.innerHeight * 0.42))
      const spaceBelow = window.innerHeight - r.bottom - gap - 8
      const spaceAbove = r.top - gap - 8
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow
      let left = r.right - panelW
      left = Math.min(Math.max(8, left), window.innerWidth - panelW - 8)
      const top = openUp
        ? Math.max(8, r.top - gap - maxH)
        : Math.min(r.bottom + gap, window.innerHeight - maxH - 8)
      setPanelPos({
        position: 'fixed',
        top,
        left,
        width: panelW,
        maxHeight: maxH,
        zIndex: 100,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [moreOpen])

  function arm(e: ReactPointerEvent | ReactMouseEvent) {
    preserveSelectionOnPointerDown(e, hold)
  }

  function run(action: PdfSelectionAction) {
    hold?.()
    setMoreOpen(false)
    onAction(action)
  }

  const moreMenu = (
    <div className="sel-menu">
      <button
        ref={moreBtnRef}
        type="button"
        className="chip chip-idle"
        aria-label="Daha fazla"
        aria-expanded={moreOpen}
        onPointerDown={arm}
        onClick={() => setMoreOpen((v) => !v)}
      >
        ⋯
      </button>
      {moreOpen && panelPos ? (
        <div
          ref={panelRef}
          className="sel-menu__panel sel-menu__panel--grid"
          style={panelPos}
          data-selection-toolbar
        >
          {TEXT_MORE.map((item, i) => (
            <button
              key={`${item.action}-${item.label}-${i}`}
              type="button"
              onPointerDown={arm}
              onClick={() => run(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )

  return (
    <div
      ref={rootRef}
      data-selection-toolbar
      className={`selection-action-bar selection-action-bar--float pdf-selection-bar${
        isRegion ? ' selection-action-bar--region' : ''
      }`}
      style={style}
    >
      <p className="selection-action-bar__preview" title={preview}>
        {isRegion ? (
          <>⬚ {preview.slice(0, 72)}</>
        ) : (
          <>
            “{preview.slice(0, 72)}
            {preview.length > 72 ? '…' : ''}”
          </>
        )}
      </p>
      <div className="selection-action-bar__actions">
        {isRegion ? (
          <>
            <button
              type="button"
              className="btn-primary selection-action-bar__ask"
              onPointerDown={arm}
              onClick={() => run('ask')}
            >
              AI'a sor
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('explain')}
            >
              Açıkla
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('summarize')}
            >
              Özetle
            </button>
            {moreMenu}
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary selection-action-bar__ask"
              onPointerDown={arm}
              onClick={() => run('ask')}
            >
              AI'a sor
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('summarize')}
            >
              Özetle
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('explain')}
            >
              Açıkla
            </button>
            {moreMenu}
          </>
        )}
      </div>
    </div>
  )
}
