import { supabase } from './supabase'
import { currentUserId } from './authSession'

const KEY = 'studium_srs_v1'

/** 0 again · 1 hard · 2 good · 3 easy */
export type SrsGrade = 0 | 1 | 2 | 3

export type SrsItem = {
  bookId: string
  chapterId: string
  /** 'chapter' for whole-unit review */
  itemKey: string
  ease: number
  intervalDays: number
  repetitions: number
  /** ISO date YYYY-MM-DD (local calendar day) */
  dueAt: string
  updatedAt: string
  lastGrade?: SrsGrade
}

type Store = Record<string, SrsItem>

function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  const dt = new Date(y!, m! - 1, d!)
  dt.setDate(dt.getDate() + days)
  return todayKey(dt)
}

function itemId(bookId: string, chapterId: string, itemKey = 'chapter') {
  return `${bookId}:${chapterId}:${itemKey}`
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Store
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* ignore */
  }
}

export function gradeFromQuizScore(ok: number, total: number): SrsGrade {
  if (total <= 0) return 1
  const pct = ok / total
  if (pct < 0.5) return 0
  if (pct < 0.7) return 1
  if (pct < 0.85) return 2
  return 3
}

export function gradeLabel(g: SrsGrade): string {
  if (g === 0) return 'Tekrar'
  if (g === 1) return 'Zor'
  if (g === 2) return 'İyi'
  return 'Kolay'
}

function defaultItem(
  bookId: string,
  chapterId: string,
  itemKey = 'chapter',
): SrsItem {
  return {
    bookId,
    chapterId,
    itemKey,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueAt: todayKey(),
    updatedAt: new Date().toISOString(),
  }
}

/** SM-2–lite scheduling. */
export function applyGrade(item: SrsItem, grade: SrsGrade): SrsItem {
  let { ease, intervalDays, repetitions } = item
  const today = todayKey()

  if (grade < 2) {
    repetitions = 0
    intervalDays = grade === 0 ? 1 : 1
    ease = Math.max(1.3, ease - 0.2)
  } else {
    if (repetitions === 0) intervalDays = 1
    else if (repetitions === 1) intervalDays = grade === 3 ? 4 : 3
    else intervalDays = Math.max(1, Math.round(intervalDays * ease))
    repetitions += 1
    ease = Math.max(
      1.3,
      ease + (0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02)),
    )
  }

  return {
    ...item,
    ease,
    intervalDays,
    repetitions,
    dueAt: addDays(today, intervalDays),
    updatedAt: new Date().toISOString(),
    lastGrade: grade,
  }
}

export function getSrsItem(
  bookId: string,
  chapterId: string,
  itemKey = 'chapter',
): SrsItem | null {
  return readStore()[itemId(bookId, chapterId, itemKey)] ?? null
}

export function reviewChapter(
  bookId: string,
  chapterId: string,
  grade: SrsGrade,
): SrsItem {
  const id = itemId(bookId, chapterId)
  const store = readStore()
  const prev = store[id] ?? defaultItem(bookId, chapterId)
  const next = applyGrade(prev, grade)
  store[id] = next
  writeStore(store)
  void pushSrsRemote(next)
  return next
}

/** Soft bump after finishing a flash deck (treat as “good”). */
export function reviewChapterAfterFlash(
  bookId: string,
  chapterId: string,
): SrsItem {
  return reviewChapter(bookId, chapterId, 2)
}

export function scheduleFromQuiz(
  bookId: string,
  chapterId: string,
  ok: number,
  total: number,
): SrsItem {
  return reviewChapter(bookId, chapterId, gradeFromQuizScore(ok, total))
}

export function listDueForBook(
  bookId: string,
  onOrBefore = todayKey(),
): SrsItem[] {
  return Object.values(readStore())
    .filter((i) => i.bookId === bookId && i.dueAt <= onOrBefore)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

export function listDueToday(bookId?: string): SrsItem[] {
  const today = todayKey()
  return Object.values(readStore())
    .filter((i) => i.dueAt <= today && (!bookId || i.bookId === bookId))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

export function isChapterDue(bookId: string, chapterId: string): boolean {
  const item = getSrsItem(bookId, chapterId)
  if (!item) return false
  return item.dueAt <= todayKey()
}

async function pushSrsRemote(item: SrsItem): Promise<void> {
  try {
    const userId = await currentUserId()
    if (!userId) return
    const { error } = await supabase.from('srs_items').upsert(
      {
        user_id: userId,
        book_id: item.bookId,
        chapter_id: item.chapterId,
        item_key: item.itemKey,
        ease: item.ease,
        interval_days: item.intervalDays,
        repetitions: item.repetitions,
        due_at: item.dueAt,
        updated_at: item.updatedAt,
        last_grade: item.lastGrade ?? null,
      },
      { onConflict: 'user_id,chapter_id,item_key' },
    )
    if (error) console.warn('srs_items upsert failed', error)
  } catch (err) {
    console.warn('srs push failed', err)
  }
}

/** Merge remote SRS into local (prefer newer updatedAt). */
export async function pullSrsForBook(bookId: string): Promise<SrsItem[]> {
  try {
    const userId = await currentUserId()
    if (!userId) return listDueForBook(bookId)

    const { data, error } = await supabase
      .from('srs_items')
      .select('*')
      .eq('user_id', userId)
      .eq('book_id', bookId)

    if (error || !data?.length) {
      if (error) console.warn('srs pull failed', error)
      return listDueForBook(bookId)
    }

    const store = readStore()
    for (const row of data) {
      const id = itemId(row.book_id, row.chapter_id, row.item_key || 'chapter')
      const remote: SrsItem = {
        bookId: row.book_id,
        chapterId: row.chapter_id,
        itemKey: row.item_key || 'chapter',
        ease: Number(row.ease) || 2.5,
        intervalDays: Number(row.interval_days) || 0,
        repetitions: Number(row.repetitions) || 0,
        dueAt: String(row.due_at).slice(0, 10),
        updatedAt: row.updated_at || new Date().toISOString(),
        lastGrade:
          typeof row.last_grade === 'number'
            ? (row.last_grade as SrsGrade)
            : undefined,
      }
      const prev = store[id]
      if (
        !prev ||
        new Date(remote.updatedAt).getTime() >=
          new Date(prev.updatedAt).getTime()
      ) {
        store[id] = remote
      } else {
        void pushSrsRemote(prev)
      }
    }
    writeStore(store)
    return listDueForBook(bookId)
  } catch {
    return listDueForBook(bookId)
  }
}
