import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { preserveSelectionOnPointerDown } from '@/hooks/useTextSelection'

type Props = {
  active?: boolean
  nudge?: boolean
  onAsk: () => void
  hold?: () => void
}

/**
 * Top-right page affordance — the one clear “ask AI” entry while reading.
 */
export default function PdfAskCorner({
  active = false,
  nudge = false,
  onAsk,
  hold,
}: Props) {
  function arm(e: ReactPointerEvent | ReactMouseEvent) {
    preserveSelectionOnPointerDown(e, hold)
  }

  return (
    <button
      type="button"
      data-selection-toolbar
      className={
        `pdf-ask-corner` +
        (active ? ' is-active' : '') +
        (nudge ? ' is-nudge' : '')
      }
      aria-label="AI'a sor"
      title={
        active
          ? 'Seçimi AI’a sor'
          : 'Metin seç, sonra AI’a sor — veya paragrafa çift tıkla'
      }
      onPointerDown={arm}
      onClick={onAsk}
    >
      <span className="pdf-ask-corner__mark" aria-hidden>
        <span className="pdf-ask-corner__orb" />
        <span className="pdf-ask-corner__ring" />
      </span>
      <span className="pdf-ask-corner__label">AI'a sor</span>
    </button>
  )
}
