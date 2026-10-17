import { supabase } from './supabase'
import { currentUserId } from './authSession'
import type { QuizResult } from '@/types/database'

/** Persist a quiz attempt (best-effort; keeps working offline/anon). */
export async function saveQuizResult(input: {
  chapterId: string
  score: number
  total: number
  answers?: Record<string, unknown> | null
}): Promise<void> {
  try {
    const userId = await currentUserId()
    const { error } = await supabase.from('quiz_results').insert({
      chapter_id: input.chapterId,
      user_id: userId,
      score: input.score,
      total: input.total,
      answers: input.answers ?? null,
    })
    if (error) console.warn('quiz_results insert failed', error)
  } catch (err) {
    console.warn('quiz_results save failed', err)
  }
}

export async function fetchChapterQuizResults(
  chapterId: string,
  limit = 20,
): Promise<QuizResult[]> {
  const { data, error } = await supabase
    .from('quiz_results')
    .select('*')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('quiz_results fetch failed', error)
    return []
  }
  return (data ?? []) as QuizResult[]
}

export type WeakChapter = {
  chapterId: string
  bestPct: number
  attempts: number
  lastScore: number
  lastTotal: number
}

/** Chapters where best score ratio is below threshold (needs review). */
export async function fetchWeakChaptersForBook(
  chapterIds: string[],
  threshold = 0.7,
): Promise<WeakChapter[]> {
  if (!chapterIds.length) return []
  const userId = await currentUserId()
  let q = supabase
    .from('quiz_results')
    .select('chapter_id, score, total, created_at')
    .in('chapter_id', chapterIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (userId) q = q.eq('user_id', userId)

  const { data, error } = await q
  if (error || !data?.length) {
    if (error) console.warn('weak chapters fetch failed', error)
    return []
  }

  const byChapter = new Map<
    string,
    { bestPct: number; attempts: number; lastScore: number; lastTotal: number }
  >()
  for (const row of data) {
    const total = Number(row.total) || 0
    const score = Number(row.score) || 0
    if (total <= 0) continue
    const pct = score / total
    const prev = byChapter.get(row.chapter_id)
    if (!prev) {
      byChapter.set(row.chapter_id, {
        bestPct: pct,
        attempts: 1,
        lastScore: score,
        lastTotal: total,
      })
    } else {
      prev.attempts += 1
      prev.bestPct = Math.max(prev.bestPct, pct)
    }
  }

  return [...byChapter.entries()]
    .map(([chapterId, v]) => ({ chapterId, ...v }))
    .filter((w) => w.bestPct < threshold)
    .sort((a, b) => a.bestPct - b.bestPct)
}
