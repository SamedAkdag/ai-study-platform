import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { preserveSelectionOnPointerDown } from '@/hooks/useTextSelection'
import type { PdfSelectionAction } from '@/types/pdfSelection'

type Props = {
  preview: string
  style?: CSSProperties
  onAction: (action: PdfSelectionAction) => void
  hold?: () => void
}

/**
 * Context toolbar after text selection: AI · Cite · İşaretle · ⋯
 * Matches Studium UX audit (max 3 primaries + overflow).
 */
export default function SelectionActionBar({
  preview,
  style,
  onAction,
  hold,
}: Props) {
  const [aiOpen, setAiOpen] = useState(false)
  const [markOpen, setMarkOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aiOpen && !markOpen && !moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setAiOpen(false)
        setMarkOpen(false)
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aiOpen, markOpen, moreOpen])

  function run(action: PdfSelectionAction) {
    hold?.()
    setAiOpen(false)
    setMarkOpen(false)
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
      <p className="selection-action-bar__preview">
        {preview.slice(0, 80)}
        {preview.length > 80 ? '…' : ''}
      </p>
      <div className="selection-action-bar__actions">
        <div className="sel-menu">
          <button
            type="button"
            className="chip chip-active"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              setAiOpen((v) => !v)
              setMarkOpen(false)
              setMoreOpen(false)
            }}
          >
            AI ▾
          </button>
          {aiOpen && (
            <div className="sel-menu__panel">
              <button type="button" onClick={() => run('ask')}>
                Sor
              </button>
              <button type="button" onClick={() => run('summarize')}>
                Özetle
              </button>
              <button type="button" onClick={() => run('explain')}>
                Açıkla
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="chip chip-idle"
          onPointerDown={preserveSelectionOnPointerDown}
          onClick={() => run('cite')}
        >
          Cite
        </button>

        <div className="sel-menu">
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              setMarkOpen((v) => !v)
              setAiOpen(false)
              setMoreOpen(false)
            }}
          >
            İşaretle ▾
          </button>
          {markOpen && (
            <div className="sel-menu__panel">
              <button type="button" onClick={() => run('highlight')}>
                Vurgula
              </button>
              <button type="button" onClick={() => run('note')}>
                Not ekle
              </button>
            </div>
          )}
        </div>

        <div className="sel-menu">
          <button
            type="button"
            className="chip chip-idle"
            onPointerDown={preserveSelectionOnPointerDown}
            onClick={() => {
              setMoreOpen((v) => !v)
              setAiOpen(false)
              setMarkOpen(false)
            }}
            aria-label="Daha fazla"
          >
            ⋯
          </button>
          {moreOpen && (
            <div className="sel-menu__panel">
              <button type="button" onClick={() => run('omit')}>
                Metni gizle
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
