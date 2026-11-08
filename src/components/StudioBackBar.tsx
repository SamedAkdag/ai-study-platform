import { useEffect } from 'react'

type Props = {
  /** Where we return — e.g. Anlatım galerisi */
  galleryLabel?: string
  /** Current tool name shown on the right */
  currentLabel?: string
  /** When false, Esc is ignored (overlays own Escape). */
  escapeEnabled?: boolean
  onBack: () => void
}

/**
 * Return control after picking a lobby card (Esc also goes back when enabled).
 */
export default function StudioBackBar({
  galleryLabel = 'Galeri',
  currentLabel,
  escapeEnabled = true,
  onBack,
}: Props) {
  useEffect(() => {
    if (!escapeEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escapeEnabled, onBack])

  return (
    <div className="studio-back">
      <button
        type="button"
        className="studio-back__btn"
        onClick={onBack}
        title={
          escapeEnabled ? `${galleryLabel} · Esc` : galleryLabel
        }
      >
        <span className="studio-back__chev" aria-hidden>
          ←
        </span>
        <span className="studio-back__copy">
          <span className="studio-back__kicker">Geri</span>
          <span className="studio-back__target">{galleryLabel}</span>
        </span>
      </button>
      {currentLabel ? (
        <p className="studio-back__now" aria-live="polite">
          {currentLabel}
          {escapeEnabled ? (
            <span className="studio-back__esc">Esc</span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
