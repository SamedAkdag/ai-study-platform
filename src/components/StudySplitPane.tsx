import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'studium.splitPdfRatio'
const DEFAULT_RATIO = 0.48

type Props = {
  left: ReactNode
  right: ReactNode
  /** Mobile: which pane is visible */
  mobilePane?: 'pdf' | 'notes'
  onMobilePaneChange?: (pane: 'pdf' | 'notes') => void
  className?: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Desktop: resizable PDF | notes. Mobile: tab toggle. */
export default function StudySplitPane({
  left,
  right,
  mobilePane = 'notes',
  onMobilePaneChange,
  className = '',
}: Props) {
  const [ratio, setRatio] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const n = raw ? Number(raw) : DEFAULT_RATIO
      return Number.isFinite(n) ? clamp(n, 0.28, 0.72) : DEFAULT_RATIO
    } catch {
      return DEFAULT_RATIO
    }
  })
  const dragging = useRef(false)
  const shellRef = useRef<HTMLDivElement>(null)

  const persist = useCallback((r: number) => {
    setRatio(r)
    try {
      localStorage.setItem(STORAGE_KEY, String(r))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !shellRef.current) return
      const rect = shellRef.current.getBoundingClientRect()
      const next = clamp((e.clientX - rect.left) / rect.width, 0.28, 0.72)
      persist(next)
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
    <div className={`study-split ${className}`}>
      <div className="study-split__mobile-tabs md:hidden">
        <button
          type="button"
          className={`chip ${mobilePane === 'pdf' ? 'chip-active' : 'chip-idle'}`}
          onClick={() => onMobilePaneChange?.('pdf')}
        >
          Orijinal PDF
        </button>
        <button
          type="button"
          className={`chip ${mobilePane === 'notes' ? 'chip-active' : 'chip-idle'}`}
          onClick={() => onMobilePaneChange?.('notes')}
        >
          AI notları
        </button>
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
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault()
            dragging.current = true
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') persist(clamp(ratio - 0.03, 0.28, 0.72))
            if (e.key === 'ArrowRight') persist(clamp(ratio + 0.03, 0.28, 0.72))
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
          {right}
        </div>
      </div>
    </div>
  )
}
