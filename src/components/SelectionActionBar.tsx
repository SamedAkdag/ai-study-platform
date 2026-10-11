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
}

/**
 * Floats under a PDF/Studium selection.
 * Primaries stay one tap: Sor · Cite · Vurgula · ⋯
 */
export default function SelectionActionBar({
  preview,
  style,
  onAction,
  hold,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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
      className="selection-action-bar selection-action-bar--float pdf-selection-bar"
      style={style}
    >
      <p className="selection-action-bar__preview" title={preview}>
        “{preview.slice(0, 72)}
        {preview.length > 72 ? '…' : ''}”
      </p>
      <div className="selection-action-bar__actions">
        <button
          type="button"
          className="btn-primary !px-3 !py-1.5 text-xs"
          onPointerDown={arm}
          onClick={() => run('ask')}
        >
          AI’ya sor
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
          onClick={() => run('highlight')}
        >
          Vurgula
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
              <button type="button" onPointerDown={arm} onClick={() => run('explain')}>
                Açıkla
              </button>
              <button type="button" onPointerDown={arm} onClick={() => run('cite')}>
                Cite
              </button>
              <button type="button" onPointerDown={arm} onClick={() => run('note')}>
                Not ekle
              </button>
              <button type="button" onPointerDown={arm} onClick={() => run('omit')}>
                Metni gizle
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
