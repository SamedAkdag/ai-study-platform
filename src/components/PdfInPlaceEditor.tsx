import { useEffect, useRef, useState } from 'react'
import type { PdfSelectionPayload } from '@/types/pdfSelection'
import type { PdfRegion } from '@/lib/pdfRegion'
import {
  DEFAULT_PDF_TEXT_STYLE,
  pdfTextStyleToField,
  type PdfTextStyle,
} from '@/lib/pdfTextStyle'

export type InPlaceReplaceDraft = {
  payload: PdfSelectionPayload
  region: PdfRegion
  /** Viewport rect of the selection — editor anchors here */
  viewport: { left: number; top: number; width: number; height: number }
  paperColor?: string
}

type Props = {
  draft: InPlaceReplaceDraft
  onCommit: (body: string) => void
  onCancel: () => void
}

/** Adobe Edit Text — field sits on the glyph box with matching paper/ink. */
export default function PdfInPlaceEditor({ draft, onCommit, onCancel }: Props) {
  const [body, setBody] = useState(draft.payload.selectedText)
  const ref = useRef<HTMLTextAreaElement>(null)
  const style: PdfTextStyle =
    draft.payload.textStyle || DEFAULT_PDF_TEXT_STYLE

  useEffect(() => {
    setBody(draft.payload.selectedText)
    const t = window.setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 30)
    return () => window.clearTimeout(t)
  }, [draft.payload.selectedText])

  const fieldH = Math.max(draft.viewport.height, style.fontSizePx * 1.15)
  const fieldW = Math.max(draft.viewport.width, style.fontSizePx * 3)

  return (
    <div
      className="pdf-inplace"
      data-selection-toolbar
      style={{
        position: 'fixed',
        left: Math.max(4, draft.viewport.left),
        top: Math.max(4, draft.viewport.top),
        width: fieldW,
        zIndex: 95,
      }}
    >
      <textarea
        ref={ref}
        className="pdf-inplace__field"
        rows={1}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (body.trim()) onCommit(body.trim())
          }
        }}
        style={{
          ...pdfTextStyleToField(style),
          background: draft.paperColor || '#ffffff',
          color: style.color,
          caretColor: style.color,
          height: fieldH,
          minHeight: fieldH,
          lineHeight: `${fieldH}px`,
          padding: '0 2px',
          fontSize: style.fontSizePx,
        }}
        aria-label="Metni düzenle"
      />
      <div className="pdf-inplace__bar">
        <button
          type="button"
          className="btn-primary text-[11px] !px-2 !py-0.5"
          disabled={!body.trim()}
          onClick={() => onCommit(body.trim())}
        >
          Uygula
        </button>
        <button
          type="button"
          className="btn-ghost text-[11px]"
          onClick={onCancel}
        >
          Vazgeç
        </button>
        <span className="muted text-[10px]">Enter</span>
      </div>
    </div>
  )
}
