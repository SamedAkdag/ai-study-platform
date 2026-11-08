import { supabase } from './supabase'
import { getOrCreateMemberKey } from './memberIdentity'

export type LibraryItem = {
  bookId: string
  title: string
  subject: string | null
  status: string | null
  shareToken: string | null
  isPublic: boolean
  source: 'mine' | 'shared' | 'group'
  /** pdf (default) | topic */
  kind?: 'pdf' | 'topic'
  href: string
  addedAt: string
}

/** Canonical ders/alan values stored on books.subject */
export const SUBJECT_OPTIONS = [
  { value: 'Math', label: 'Matematik', tone: 'tone-math' },
  { value: 'Physics', label: 'Fizik', tone: 'tone-phys' },
  { value: 'History', label: 'Tarih', tone: 'tone-hist' },
  { value: 'Law', label: 'Hukuk / Maliye', tone: 'tone-law' },
  { value: 'Other', label: 'Diğer', tone: 'tone-default' },
] as const

export type SubjectValue = (typeof SUBJECT_OPTIONS)[number]['value']

export function normalizeSubjectKey(
  subject: string | null | undefined,
): SubjectValue {
  const s = (subject || '').trim().toLowerCase()
  if (!s) return 'Other'
  if (s.includes('math') || s.includes('matematik')) return 'Math'
  if (s.includes('phys') || s.includes('fizik')) return 'Physics'
  if (s.includes('hist') || s.includes('tarih')) return 'History'
  if (s.includes('law') || s.includes('hukuk') || s.includes('maliye'))
    return 'Law'
  if (s === 'other' || s.includes('diğer') || s.includes('diger')) return 'Other'
  return 'Other'
}

export function subjectLabel(subject: string | null | undefined): string {
  const key = normalizeSubjectKey(subject)
  return SUBJECT_OPTIONS.find((o) => o.value === key)?.label ?? 'Diğer'
}

export function subjectToneClass(subject: string | null | undefined): string {
  const key = normalizeSubjectKey(subject)
  return SUBJECT_OPTIONS.find((o) => o.value === key)?.tone ?? 'tone-default'
}

export type SubjectShelfGroup = {
  key: SubjectValue
  label: string
  items: LibraryItem[]
}

/** Group library items by ders — empty subjects → Diğer. */
export function groupLibraryBySubject(
  items: LibraryItem[],
): SubjectShelfGroup[] {
  const buckets = new Map<SubjectValue, LibraryItem[]>()
  for (const opt of SUBJECT_OPTIONS) buckets.set(opt.value, [])
  for (const item of items) {
    const key = normalizeSubjectKey(item.subject)
    buckets.get(key)!.push(item)
  }
  return SUBJECT_OPTIONS.map((opt) => ({
    key: opt.value,
    label: opt.label,
    items: buckets.get(opt.value) ?? [],
  })).filter((g) => g.items.length > 0)
}

const LOCAL_KEY = 'studium_library_v1'

type LocalEntry = {
  bookId: string
  title: string
  subject?: string | null
  shareToken: string | null
  source: 'mine' | 'shared' | 'group'
  addedAt: string
}

function readLocal(): LocalEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as LocalEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(entries: LocalEntry[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries.slice(0, 80)))
  } catch {
    /* ignore */
  }
}

/** Persist a book on this device shelf (guest mine + shared/group pins). */
export function rememberLibraryBook(input: {
  bookId: string
  title: string
  subject?: string | null
  shareToken?: string | null
  source: 'mine' | 'shared' | 'group'
}) {
  const entries = readLocal().filter((e) => e.bookId !== input.bookId)
  entries.unshift({
    bookId: input.bookId,
    title: input.title,
    subject: input.subject ?? null,
    shareToken: input.shareToken ?? null,
    source: input.source,
    addedAt: new Date().toISOString(),
  })
  writeLocal(entries)
}

/** Remove a remembered shared/group pin from the local shelf. */
export function forgetLibraryBook(bookId: string) {
  writeLocal(readLocal().filter((e) => e.bookId !== bookId))
}

/** Hidden book ids (local) — soft-remove from shelf without deleting server data. */
const HIDDEN_KEY = 'studium_library_hidden_v1'

export function getHiddenLibraryIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export function hideLibraryBook(bookId: string) {
  const set = getHiddenLibraryIds()
  set.add(bookId)
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
  forgetLibraryBook(bookId)
}

export function libraryHref(item: {
  bookId: string
  shareToken: string | null
  isPublic?: boolean
  source: LibraryItem['source']
  kind?: 'pdf' | 'topic'
}) {
  if (
    (item.source === 'shared' || item.source === 'group') &&
    item.shareToken &&
    item.isPublic !== false
  ) {
    return `/s/${item.shareToken}`
  }
  if (item.kind === 'topic') return `/study/${item.bookId}`
  if (item.source === 'mine') return `/books/${item.bookId}/read`
  if (item.shareToken) return `/s/${item.shareToken}`
  return `/books/${item.bookId}/read`
}

/** Study desk after upload / from book hub. */
export function studyDeskHref(bookId: string) {
  return `/study/${bookId}`
}

export async function fetchMyLibrary(userId?: string | null): Promise<LibraryItem[]> {
  const byId = new Map<string, LibraryItem>()

  // 1) Own books (when logged in)
  if (userId) {
    const { data: mine } = await supabase
      .from('books')
      .select(
        'id, title, subject, status, share_token, is_public, created_at, source_kind, file_url',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40)

    for (const b of mine ?? []) {
      const kind = b.source_kind === 'topic' ? 'topic' : 'pdf'
      byId.set(b.id, {
        bookId: b.id,
        title: b.title,
        subject: b.subject,
        status: b.status,
        shareToken: b.share_token,
        isPublic: !!b.is_public,
        source: 'mine',
        kind,
        href: libraryHref({
          bookId: b.id,
          shareToken: b.share_token,
          isPublic: !!b.is_public,
          source: 'mine',
          kind,
        }),
        addedAt: b.created_at,
      })
    }

    // 2) Friend shares inbox
    const { data: shares } = await supabase
      .from('study_shares')
      .select('book_id, created_at, note')
      .eq('to_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40)

    const shareBookIds = [...new Set((shares ?? []).map((s) => s.book_id))]
    if (shareBookIds.length) {
      const { data: books } = await supabase
        .from('books')
        .select('id, title, subject, status, share_token, is_public, created_at')
        .in('id', shareBookIds)
      const shareAt = new Map(
        (shares ?? []).map((s) => [s.book_id, s.created_at]),
      )
      for (const b of books ?? []) {
        if (byId.has(b.id)) continue
        byId.set(b.id, {
          bookId: b.id,
          title: b.title,
          subject: b.subject,
          status: b.status,
          shareToken: b.share_token,
          isPublic: !!b.is_public,
          source: 'shared',
          href: libraryHref({
            bookId: b.id,
            shareToken: b.share_token,
            isPublic: !!b.is_public,
            source: 'shared',
          }),
          addedAt: shareAt.get(b.id) || b.created_at,
        })
      }
    }

    // 3) Groups I'm a member of
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id, joined_at')
      .eq('user_id', userId)
      .limit(40)

    const groupIds = (memberships ?? []).map((m) => m.group_id)
    if (groupIds.length) {
      const { data: groups } = await supabase
        .from('study_groups')
        .select('id, book_id, created_at')
        .in('id', groupIds)
      const bookIds = [...new Set((groups ?? []).map((g) => g.book_id))]
      if (bookIds.length) {
        const { data: books } = await supabase
          .from('books')
          .select('id, title, subject, status, share_token, is_public, created_at')
          .in('id', bookIds)
        const joinedAt = new Map(
          (memberships ?? []).map((m) => [m.group_id, m.joined_at]),
        )
        const groupByBook = new Map(
          (groups ?? []).map((g) => [g.book_id, g]),
        )
        for (const b of books ?? []) {
          if (byId.has(b.id)) continue
          const g = groupByBook.get(b.id)
          byId.set(b.id, {
            bookId: b.id,
            title: b.title,
            subject: b.subject,
            status: b.status,
            shareToken: b.share_token,
            isPublic: !!b.is_public,
            source: 'group',
            href: libraryHref({
              bookId: b.id,
              shareToken: b.share_token,
              isPublic: !!b.is_public,
              source: 'group',
            }),
            addedAt: (g && joinedAt.get(g.id)) || b.created_at,
          })
        }
      }
    }
  }

  // 4) Also memberships by this browser member_key (invite join without login)
  const memberKey = getOrCreateMemberKey()
  const { data: keyMembers } = await supabase
    .from('group_members')
    .select('group_id, joined_at')
    .eq('member_key', memberKey)
    .limit(40)

  const keyGroupIds = (keyMembers ?? []).map((m) => m.group_id)
  if (keyGroupIds.length) {
    const { data: groups } = await supabase
      .from('study_groups')
      .select('id, book_id')
      .in('id', keyGroupIds)
    const bookIds = [...new Set((groups ?? []).map((g) => g.book_id))]
    if (bookIds.length) {
      const { data: books } = await supabase
        .from('books')
        .select('id, title, subject, status, share_token, is_public, created_at')
        .in('id', bookIds)
      const joinedAt = new Map(
        (keyMembers ?? []).map((m) => [m.group_id, m.joined_at]),
      )
      const groupByBook = new Map((groups ?? []).map((g) => [g.book_id, g]))
      for (const b of books ?? []) {
        if (byId.has(b.id)) continue
        const g = groupByBook.get(b.id)
        byId.set(b.id, {
          bookId: b.id,
          title: b.title,
          subject: b.subject,
          status: b.status,
          shareToken: b.share_token,
          isPublic: !!b.is_public,
          source: 'group',
          href: libraryHref({
            bookId: b.id,
            shareToken: b.share_token,
            isPublic: !!b.is_public,
            source: 'group',
          }),
          addedAt: (g && joinedAt.get(g.id)) || b.created_at,
        })
      }
    }
  }

  // 5) Local remembered entries (guest uploads + shared/group pins)
  const hidden = getHiddenLibraryIds()
  for (const e of readLocal()) {
    if (byId.has(e.bookId) || hidden.has(e.bookId)) continue
    const source = e.source === 'mine' || e.source === 'shared' || e.source === 'group'
      ? e.source
      : 'shared'
    byId.set(e.bookId, {
      bookId: e.bookId,
      title: e.title,
      subject: e.subject ?? null,
      status: 'ready',
      shareToken: e.shareToken,
      isPublic: !!e.shareToken,
      source,
      href: libraryHref({
        bookId: e.bookId,
        shareToken: e.shareToken,
        isPublic: !!e.shareToken,
        source,
      }),
      addedAt: e.addedAt,
    })
  }

  return [...byId.values()]
    .filter((item) => !hidden.has(item.bookId) || item.source === 'mine')
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}
