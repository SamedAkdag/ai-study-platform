import type { LibraryItem } from '@/lib/library'
import {
  loadPdfAnnotations,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import { listDueToday } from '@/lib/srs'
import { getBookProgress, summarizeBookProgress } from '@/lib/studyProgress'

export type ContinueBook = {
  item: LibraryItem
  pct: number
  opened: number
  chapterCount: number
  lastOpenedAt: string | null
  dueCount: number
}

export type NoteListItem = {
  bookId: string
  bookTitle: string
  href: string
  annotation: PdfAnnotation
}

/** Due SRS items across all books (local store). */
export function countDueSrs(bookId?: string): number {
  return listDueToday(bookId).length
}

export function bookProgressPct(bookId: string): {
  pct: number
  opened: number
  chapterCount: number
  lastOpenedAt: string | null
} {
  const map = getBookProgress(bookId)
  const ids = Object.keys(map)
  const summary = summarizeBookProgress(bookId, ids)
  const chapterCount = Math.max(ids.length, summary.total)
  const pct =
    chapterCount > 0 && summary.opened > 0
      ? Math.min(
          100,
          Math.round((summary.opened / Math.max(chapterCount, 1)) * 100),
        )
      : 0
  let lastOpenedAt: string | null = null
  for (const p of Object.values(map)) {
    if (!p.openedAt) continue
    if (!lastOpenedAt || p.openedAt > lastOpenedAt) lastOpenedAt = p.openedAt
  }
  return { pct, opened: summary.opened, chapterCount, lastOpenedAt }
}

/**
 * Prefer the most recently opened book; fall back to newest library item
 * that has any progress, else newest mine book.
 */
export function pickContinueBook(
  items: LibraryItem[],
): ContinueBook | null {
  if (!items.length) return null

  const scored = items.map((item) => {
    const prog = bookProgressPct(item.bookId)
    return {
      item,
      ...prog,
      dueCount: countDueSrs(item.bookId),
      score: prog.lastOpenedAt || item.addedAt,
    }
  })

  scored.sort((a, b) => {
    const aOpen = a.lastOpenedAt ? 1 : 0
    const bOpen = b.lastOpenedAt ? 1 : 0
    if (aOpen !== bOpen) return bOpen - aOpen
    if (a.pct !== b.pct && (a.pct > 0 || b.pct > 0)) return b.pct - a.pct
    return b.score.localeCompare(a.score)
  })

  const top = scored[0]
  if (!top) return null
  return {
    item: top.item,
    pct: top.pct,
    opened: top.opened,
    chapterCount: top.chapterCount,
    lastOpenedAt: top.lastOpenedAt,
    dueCount: top.dueCount,
  }
}

/** Collect local PDF annotations for the given library books. */
export function collectAllNotes(
  items: LibraryItem[],
): NoteListItem[] {
  const out: NoteListItem[] = []
  for (const item of items) {
    const anns = loadPdfAnnotations(item.bookId)
    for (const a of anns) {
      if (!a.body?.trim() && !a.quote?.trim()) continue
      out.push({
        bookId: item.bookId,
        bookTitle: item.title,
        // Always open the PDF reader (share hubs ignore ?page=)
        href: `/books/${item.bookId}/read?page=${a.page}`,
        annotation: a,
      })
    }
  }
  out.sort((a, b) =>
    b.annotation.createdAt.localeCompare(a.annotation.createdAt),
  )
  return out
}

export function countAllNotes(items: LibraryItem[]): number {
  return collectAllNotes(items).length
}

export function greetingName(input: {
  displayName?: string | null
  username?: string | null
}): string {
  const d = (input.displayName || '').trim()
  if (d) return d.split(/\s+/)[0] || d
  const u = (input.username || '').trim()
  if (u) return u
  return 'Sen'
}

export function formatShortWhen(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    const time = d.toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    if (sameDay) return `Bugün ${time}`
    return d.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function formatWorkspaceDate(d = new Date()): {
  weekday: string
  dayMonth: string
  day: string
  monthShort: string
} {
  const weekday = d.toLocaleDateString('tr-TR', { weekday: 'long' })
  const dayMonth = d.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
  })
  const day = String(d.getDate())
  const monthShort = d
    .toLocaleDateString('tr-TR', { month: 'short' })
    .replace(/\./g, '')
    .toUpperCase()
  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    dayMonth,
    day,
    monthShort,
  }
}
