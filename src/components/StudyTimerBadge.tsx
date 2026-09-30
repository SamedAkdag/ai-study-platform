import { useStudyClock } from '@/hooks/useStudySession'

type Props = {
  bookId?: string | null
  showBook?: boolean
}

export default function StudyTimerBadge({ bookId, showBook }: Props) {
  const { totalLabel, bookLabel } = useStudyClock(bookId)

  return (
    <div className="timer-badge" title="Odaklanmış çalışma süresi">
      <span className="timer-dot" aria-hidden />
      <span>
        <span className="muted text-[11px] tracking-wide uppercase">Süre</span>
        <strong className="ml-1.5 font-semibold tabular-nums">{totalLabel}</strong>
      </span>
      {showBook && bookId && (
        <span className="muted hidden text-xs sm:inline">
          · bu kitap {bookLabel}
        </span>
      )}
    </div>
  )
}
