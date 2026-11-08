import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'studium.splitPdfRatio'
/** PDF kahraman (~70), AI gölge (~30). */
const DEFAULT_RATIO = 0.7

type Props = {
  left: ReactNode
  right: ReactNode
  /** Label for the right pane (mobile tab). */
  rightLabel?: string
  /** Mobile: which pane is visible */
  mobilePane?: 'pdf' | 'notes'
  onMobilePaneChange?: (pane: 'pdf' | 'notes') => void
  /** Hide notes rail so PDF fills the stage (reading room). */
  collapseNotes?: boolean
  /** Sticky AI rail while the PDF column scrolls (desktop). */
  stickyAssist?: boolean
  className?: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Desktop: resizable PDF | study surface. Mobile: tab toggle. */
export default function StudySplitPane({
  left,
  right,
  rightLabel = 'Notlar',
  mobilePane = 'notes',
  onMobilePaneChange,
  collapseNotes = false,
  stickyAssist = false,
  className = '',
}: Props) {
  const [ratio, setRatio] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const n = raw ? Number(raw) : DEFAULT_RATIO
      return Number.isFinite(n) ? clamp(n, 0.45, 0.82) : DEFAULT_RATIO
    } catch {
      return DEFAULT_RATIO
    }
  })
  const dragging = useRef(false)
  const shellRef = useRef<HTMLDivElement>(null)

  const persist = useCallback((r: number) => {
    const next = clamp(r, 0.45, 0.82)
    setRatio(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !shellRef.current) return
      const rect = shellRef.current.getBoundingClientRect()
      persist((e.clientX - rect.left) / rect.width)
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [persist])

  return (
    <div
      className={`study-split${collapseNotes ? ' study-split--pdf-focus' : ''}${
        stickyAssist ? ' study-split--sticky-assist' : ''
      }${className ? ` ${className}` : ''}`}
    >
      {/* Mobile-only: switch panes. Desktop always shows both. */}
      {!collapseNotes ? (
        <div
          className="study-split__mobile-tabs mode-segment mode-segment--primary"
          role="tablist"
          aria-label="Panel"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === 'pdf'}
            className={`chip ${mobilePane === 'pdf' ? 'chip-active' : 'chip-idle'}`}
            onClick={() => onMobilePaneChange?.('pdf')}
          >
            PDF
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === 'notes'}
            className={`chip ${mobilePane === 'notes' ? 'chip-active' : 'chip-idle'}`}
            onClick={() => onMobilePaneChange?.('notes')}
          >
            {rightLabel}
          </button>
        </div>
      ) : null}

      <div ref={shellRef} className="study-split__shell">
        <div
          className={`study-split__pane study-split__pane--pdf ${
            mobilePane === 'pdf' || collapseNotes ? 'is-mobile-show' : ''
          }`}
          style={{ flexBasis: collapseNotes ? '100%' : `${ratio * 100}%` }}
        >
          {left}
        </div>

        {!collapseNotes ? (
          <div
            className="study-split__handle"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(ratio * 100)}
            aria-label="PDF paneli genişliği"
            title="Sürükle · çift tık varsayılan"
            tabIndex={0}
            onPointerDown={(e) => {
              e.preventDefault()
              dragging.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
            onDoubleClick={() => persist(DEFAULT_RATIO)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') persist(ratio - 0.03)
              if (e.key === 'ArrowRight') persist(ratio + 0.03)
              if (e.key === 'Home') persist(DEFAULT_RATIO)
            }}
          >
            <span />
          </div>
        ) : null}

        {!collapseNotes ? (
          <div
            className={`study-split__pane study-split__pane--notes ${
              mobilePane === 'notes' ? 'is-mobile-show' : ''
            }`}
            style={{ flexBasis: `${(1 - ratio) * 100}%` }}
          >
            <div className="study-split__notes-inner">{right}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
