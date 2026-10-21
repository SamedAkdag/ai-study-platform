import {
  useEffect,
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
}

/**
 * Floats under a PDF selection — Adobe-like text tools + study AI.
 * Primaries (text): Değiştir · Sansür · Vurgu · ⋯
 * Primaries (region): Açıkla · Özetle · AI’ya sor · Not
 */
export default function SelectionActionBar({
  preview,
  style,
  onAction,
  hold,
  variant = 'text',
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const isRegion = variant === 'region'

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  function arm(e: ReactPointerEvent | ReactMouseEvent) {
    preserveSelectionOnPointerDown(e, hold)
  }

  function run(action: PdfSelectionAction) {
    hold?.()
    setMoreOpen(false)
    onAction(action)
  }

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
              className="btn-primary !px-3 !py-1.5 text-xs"
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
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('ask')}
            >
              AI’ya sor
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('note')}
            >
              Not
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 text-xs"
              onPointerDown={arm}
              onClick={() => run('replace')}
            >
              Değiştir
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('redact')}
            >
              Sansür
            </button>
            <button
              type="button"
              className="chip chip-idle"
              onPointerDown={arm}
              onClick={() => run('highlight')}
            >
              Vurgu
            </button>
            <div className="sel-menu">
              <button
                type="button"
                className="chip chip-idle"
                aria-label="Daha fazla"
                aria-expanded={moreOpen}
                onPointerDown={arm}
                onClick={() => setMoreOpen((v) => !v)}
              >
                ⋯
              </button>
              {moreOpen && (
                <div className="sel-menu__panel">
                  <button type="button" onPointerDown={arm} onClick={() => run('ask')}>
                    AI’ya sor
                  </button>
                  <button type="button" onPointerDown={arm} onClick={() => run('note')}>
                    Not ekle
                  </button>
                  <button type="button" onPointerDown={arm} onClick={() => run('cite')}>
                    Cite
                  </button>
                  <button
                    type="button"
                    onPointerDown={arm}
                    onClick={() => run('summarize')}
                  >
                    Özetle
                  </button>
                  <button
                    type="button"
                    onPointerDown={arm}
                    onClick={() => run('explain')}
                  >
                    Açıkla
                  </button>
                  <button
                    type="button"
                    onPointerDown={arm}
                    onClick={() => run('underline')}
                  >
                    Altını çiz
                  </button>
                  <button
                    type="button"
                    onPointerDown={arm}
                    onClick={() => run('strike')}
                  >
                    Üstünü çiz
                  </button>
                  <button type="button" onPointerDown={arm} onClick={() => run('copy')}>
                    Kopyala
                  </button>
                  <button
                    type="button"
                    onPointerDown={arm}
                    onClick={() => run('bookmark')}
                  >
                    Yer imi
                  </button>
                  <button type="button" onPointerDown={arm} onClick={() => run('omit')}>
                    Metni gizle
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
