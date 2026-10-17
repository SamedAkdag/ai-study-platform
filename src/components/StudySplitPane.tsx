import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'studium.splitPdfRatio'
const DEFAULT_RATIO = 0.5
const PRESETS = [
  { id: '40', ratio: 0.4, label: '40' },
  { id: '50', ratio: 0.5, label: '50' },
  { id: '60', ratio: 0.6, label: '60' },
] as const

type Props = {
  left: ReactNode
  right: ReactNode
  /** Label for the right pane (desktop toolbar). */
  rightLabel?: string
  /** Mobile: which pane is visible */
  mobilePane?: 'pdf' | 'notes'
  onMobilePaneChange?: (pane: 'pdf' | 'notes') => void
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
  className = '',
}: Props) {
  const [ratio, setRatio] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const n = raw ? Number(raw) : DEFAULT_RATIO
      return Number.isFinite(n) ? clamp(n, 0.32, 0.68) : DEFAULT_RATIO
    } catch {
      return DEFAULT_RATIO
    }
  })
  const dragging = useRef(false)
  const shellRef = useRef<HTMLDivElement>(null)

  const persist = useCallback((r: number) => {
    const next = clamp(r, 0.32, 0.68)
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

  const activePreset = PRESETS.find((p) => Math.abs(p.ratio - ratio) < 0.02)

  return (
    <div className={`study-split ${className}`}>
      <div className="study-split__toolbar">
        <div
          className="study-split__mobile-tabs md:hidden"
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
            Kaynak
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

        <div className="study-split__presets hidden md:flex" role="group" aria-label="PDF oranı">
          <span className="study-split__presets-label">PDF</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${
                activePreset?.id === p.id ? 'chip-active' : 'chip-idle'
              }`}
              aria-pressed={activePreset?.id === p.id}
              onClick={() => persist(p.ratio)}
            >
              {p.label}%
            </button>
          ))}
          <span className="study-split__presets-hint muted">
            Sürükle · çift tık 50%
          </span>
        </div>
      </div>

      <div ref={shellRef} className="study-split__shell">
        <div
          className={`study-split__pane study-split__pane--pdf ${
            mobilePane === 'pdf' ? 'is-mobile-show' : ''
          }`}
          style={{ flexBasis: `${ratio * 100}%` }}
        >
          {left}
        </div>

        <div
          className="study-split__handle hidden md:flex"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(ratio * 100)}
          aria-label="PDF paneli genişliği"
          title="Sürükle · çift tık 50%"
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

        <div
          className={`study-split__pane study-split__pane--notes ${
            mobilePane === 'notes' ? 'is-mobile-show' : ''
          }`}
          style={{ flexBasis: `${(1 - ratio) * 100}%` }}
        >
          <div className="study-split__notes-inner">{right}</div>
        </div>
      </div>
    </div>
  )
}
