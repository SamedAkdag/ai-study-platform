import { useEffect, useState } from 'react'

type Props = {
  page: number
  maxPage: number
  minPage?: number
  loadingHint?: boolean
  onJump: (page: number) => void
  className?: string
}

/** Sayfa numarası yazıp Enter / blur ile atla (PDF tarzı). */
export default function PageJumpControl({
  page,
  maxPage,
  minPage = 1,
  loadingHint = false,
  onJump,
  className = '',
}: Props) {
  const [draft, setDraft] = useState(String(page))

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  function commit() {
    const n = Number.parseInt(draft.replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(n)) {
      setDraft(String(page))
      return
    }
    const clamped = Math.min(Math.max(n, minPage), Math.max(minPage, maxPage))
    setDraft(String(clamped))
    if (clamped !== page) onJump(clamped)
  }

  return (
    <span className={`page-jump ${className}`.trim()}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="page-jump__input tabular-nums"
        value={draft}
        aria-label="Sayfa numarası"
        title="Sayfa numarası yazıp Enter"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
            commit()
          } else if (e.key === 'Escape') {
            setDraft(String(page))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onFocus={(e) => e.target.select()}
      />
      <span className="page-jump__sep muted">/</span>
      <span className="page-jump__max tabular-nums muted">
        {maxPage || '…'}
        {loadingHint ? '…' : ''}
      </span>
    </span>
  )
}
