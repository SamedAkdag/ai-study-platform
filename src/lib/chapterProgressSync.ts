import { supabase } from './supabase'
import { currentUserId } from './authSession'
import type { ChapterProgress } from './studyProgress'
import { getBookProgress } from './studyProgress'

/** Upsert opened / quiz fields for signed-in user. */
export async function syncChapterProgressRemote(input: {
  bookId: string
  chapterId: string
  openedAt?: string
  quizOk?: number
  quizTotal?: number
  quizAt?: string
}): Promise<void> {
  try {
    const userId = await currentUserId()
    if (!userId) return

    const patch: Record<string, unknown> = {
      user_id: userId,
      book_id: input.bookId,
      chapter_id: input.chapterId,
      updated_at: new Date().toISOString(),
    }
    if (input.openedAt) patch.opened_at = input.openedAt
    if (typeof input.quizOk === 'number') patch.quiz_ok = input.quizOk
    if (typeof input.quizTotal === 'number') patch.quiz_total = input.quizTotal
    if (input.quizAt) patch.quiz_at = input.quizAt

    const { error } = await supabase.from('chapter_progress').upsert(patch, {
      onConflict: 'user_id,chapter_id',
    })
    if (error) console.warn('chapter_progress upsert failed', error)
  } catch (err) {
    console.warn('chapter_progress sync failed', err)
  }
}

/**
 * Pull remote progress into localStorage (merge: prefer newer quiz_at / keep opened).
 */
export async function pullChapterProgressForBook(
  bookId: string,
): Promise<Record<string, ChapterProgress>> {
  const local = getBookProgress(bookId)
  try {
    const userId = await currentUserId()
    if (!userId) return local

    const { data, error } = await supabase
      .from('chapter_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('book_id', bookId)

    if (error || !data?.length) {
      if (error) console.warn('chapter_progress pull failed', error)
      return local
    }

    const merged: Record<string, ChapterProgress> = { ...local }
    for (const row of data) {
      const prev = merged[row.chapter_id] ?? {}
      const remoteQuizNewer =
        row.quiz_at &&
        (!prev.quizAt ||
          new Date(row.quiz_at).getTime() >= new Date(prev.quizAt).getTime())
      merged[row.chapter_id] = {
        openedAt: prev.openedAt || row.opened_at || undefined,
        quizOk: remoteQuizNewer
          ? (row.quiz_ok ?? prev.quizOk)
          : prev.quizOk,
        quizTotal: remoteQuizNewer
          ? (row.quiz_total ?? prev.quizTotal)
          : prev.quizTotal,
        quizAt: remoteQuizNewer
          ? (row.quiz_at ?? prev.quizAt)
          : prev.quizAt,
      }
    }

    // write merged back to local store
    const KEY = 'studium_progress_v1'
    try {
      const raw = localStorage.getItem(KEY)
      const store = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      store[bookId] = merged
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }

    return merged
  } catch {
    return local
  }
}
