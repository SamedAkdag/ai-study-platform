const TOTAL_KEY = 'studium_total_seconds'
const BOOK_PREFIX = 'studium_book_seconds:'
export const STUDY_TICK_EVENT = 'studium-study-tick'

export function getTotalStudySeconds(): number {
  return readInt(TOTAL_KEY)
}

export function getBookStudySeconds(bookId: string): number {
  return readInt(BOOK_PREFIX + bookId)
}

export function addStudySeconds(seconds: number, bookId?: string | null) {
  if (seconds <= 0) return
  const nextTotal = getTotalStudySeconds() + seconds
  writeInt(TOTAL_KEY, nextTotal)
  if (bookId) {
    writeInt(BOOK_PREFIX + bookId, getBookStudySeconds(bookId) + seconds)
  }
  window.dispatchEvent(
    new CustomEvent(STUDY_TICK_EVENT, {
      detail: { total: nextTotal, bookId: bookId ?? null },
    }),
  )
}

export function formatStudyDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${m}:${String(sec).padStart(2, '0')}`
}

function readInt(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    const n = raw ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function writeInt(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.max(0, Math.floor(value))))
  } catch {
    /* private mode */
  }
}
