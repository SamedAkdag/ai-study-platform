const KEY = 'studium_progress_v1'

export type ChapterProgress = {
  openedAt?: string
  quizOk?: number
  quizTotal?: number
  quizAt?: string
}

type Store = Record<string, Record<string, ChapterProgress>>

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

export function getBookProgress(bookId: string): Record<string, ChapterProgress> {
  return readStore()[bookId] ?? {}
}

export function markChapterOpened(bookId: string, chapterId: string) {
  const store = readStore()
  const book = store[bookId] ?? {}
  const prev = book[chapterId] ?? {}
  book[chapterId] = {
    ...prev,
    openedAt: prev.openedAt || new Date().toISOString(),
  }
  store[bookId] = book
  writeStore(store)
}

export function markChapterQuiz(
  bookId: string,
  chapterId: string,
  ok: number,
  total: number,
) {
  const store = readStore()
  const book = store[bookId] ?? {}
  const prev = book[chapterId] ?? {}
  book[chapterId] = {
    ...prev,
    openedAt: prev.openedAt || new Date().toISOString(),
    quizOk: ok,
    quizTotal: total,
    quizAt: new Date().toISOString(),
  }
  store[bookId] = book
  writeStore(store)
}

export function summarizeBookProgress(
  bookId: string,
  chapterIds: string[],
): { opened: number; quizzed: number; total: number; remaining: number } {
  const book = getBookProgress(bookId)
  let opened = 0
  let quizzed = 0
  for (const id of chapterIds) {
    const p = book[id]
    if (p?.openedAt) opened += 1
    if (p?.quizAt && typeof p.quizOk === 'number') quizzed += 1
  }
  const total = chapterIds.length
  return {
    opened,
    quizzed,
    total,
    remaining: Math.max(0, total - opened),
  }
}

export function chapterProgressLabel(p?: ChapterProgress | null): string | null {
  if (!p) return null
  if (p.quizAt && typeof p.quizOk === 'number' && typeof p.quizTotal === 'number') {
    return `Quiz ${p.quizOk}/${p.quizTotal}`
  }
  if (p.openedAt) return 'Okundu'
  return null
}
