import { useEffect, useState } from 'react'
import {
  STUDY_TICK_EVENT,
  addStudySeconds,
  formatStudyDuration,
  getBookStudySeconds,
  getTotalStudySeconds,
} from '@/lib/studyTimer'
import { bumpBookStudySeconds } from '@/lib/api'
import { bumpStudyFocus } from '@/lib/social'
import { supabase } from '@/lib/supabase'

/** Counts focused study time while the tab is visible. */
export function useStudySession(
  bookId?: string | null,
  chapterId?: string | null,
) {
  useEffect(() => {
    let last = Date.now()
    let sinceFlush = 0

    const flush = async (seconds: number) => {
      if (seconds <= 0 || !bookId) return
      void bumpBookStudySeconds(bookId, seconds).catch(() => {})
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const userId = session?.user?.id
        if (userId) {
          await bumpStudyFocus({
            userId,
            bookId,
            chapterId: chapterId ?? null,
            seconds,
          })
        }
      } catch {
        /* stats optional until migration */
      }
    }

    const tick = () => {
      if (document.visibilityState !== 'visible') {
        last = Date.now()
        return
      }
      const now = Date.now()
      const delta = Math.floor((now - last) / 1000)
      last = now
      if (delta <= 0) return
      addStudySeconds(delta, bookId)
      sinceFlush += delta
      if (bookId && sinceFlush >= 20) {
        const chunk = sinceFlush
        sinceFlush = 0
        void flush(chunk)
      }
    }

    const id = window.setInterval(tick, 1000)
    const onVis = () => {
      last = Date.now()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      if (bookId && sinceFlush > 0) {
        void flush(sinceFlush)
      }
    }
  }, [bookId, chapterId])
}

export function useStudyClock(bookId?: string | null) {
  const [total, setTotal] = useState(() => getTotalStudySeconds())
  const [book, setBook] = useState(() =>
    bookId ? getBookStudySeconds(bookId) : 0,
  )

  useEffect(() => {
    const sync = () => {
      setTotal(getTotalStudySeconds())
      if (bookId) setBook(getBookStudySeconds(bookId))
    }
    sync()
    window.addEventListener(STUDY_TICK_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(STUDY_TICK_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [bookId])

  return {
    totalSeconds: total,
    bookSeconds: book,
    totalLabel: formatStudyDuration(total),
    bookLabel: formatStudyDuration(book),
  }
}
