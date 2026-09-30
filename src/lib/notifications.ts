import { supabase } from './supabase'
import { roleAtLeast } from './studyGroup'
import type { GroupRole } from '@/types/database'

export type AppNotification = {
  id: string
  kind: 'friend_request' | 'study_share' | 'contribution_pending'
  title: string
  body: string
  href: string
  createdAt: string
}

export async function fetchNotifications(
  userId: string,
): Promise<AppNotification[]> {
  const items: AppNotification[] = []

  // Friend requests to me
  const { data: friendReqs } = await supabase
    .from('friendships')
    .select('id, requester_id, created_at')
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20)

  const requesterIds = [...new Set((friendReqs ?? []).map((f) => f.requester_id))]
  let nameByUser = new Map<string, string>()
  if (requesterIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', requesterIds)
    nameByUser = new Map(
      (profiles ?? []).map((p) => [
        p.user_id,
        p.username ? `@${p.username}` : p.display_name,
      ]),
    )
  }

  for (const f of friendReqs ?? []) {
    items.push({
      id: `friend-${f.id}`,
      kind: 'friend_request',
      title: 'Arkadaşlık isteği',
      body: `${nameByUser.get(f.requester_id) || 'Biri'} seni eklemek istiyor`,
      href: '/social',
      createdAt: f.created_at,
    })
  }

  // Unread study shares
  const { data: shares } = await supabase
    .from('study_shares')
    .select('id, from_user_id, book_id, note, created_at, read_at')
    .eq('to_user_id', userId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(20)

  const fromIds = [...new Set((shares ?? []).map((s) => s.from_user_id))]
  const bookIds = [...new Set((shares ?? []).map((s) => s.book_id))]
  if (fromIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', fromIds)
    for (const p of profiles ?? []) {
      nameByUser.set(
        p.user_id,
        p.username ? `@${p.username}` : p.display_name,
      )
    }
  }
  const bookTitle = new Map<string, string>()
  const bookShare = new Map<string, string | null>()
  if (bookIds.length) {
    const { data: books } = await supabase
      .from('books')
      .select('id, title, share_token, is_public')
      .in('id', bookIds)
    for (const b of books ?? []) {
      bookTitle.set(b.id, b.title)
      bookShare.set(
        b.id,
        b.is_public && b.share_token ? b.share_token : null,
      )
    }
  }

  for (const s of shares ?? []) {
    const token = bookShare.get(s.book_id)
    items.push({
      id: `share-${s.id}`,
      kind: 'study_share',
      title: 'Yeni çalışma',
      body: `${nameByUser.get(s.from_user_id) || 'Bir arkadaş'} “${bookTitle.get(s.book_id) || 'kitap'}” gönderdi`,
      href: token ? `/s/${token}` : '/',
      createdAt: s.created_at,
    })
  }

  // Pending contributions in groups where I'm admin/owner
  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', userId)

  const adminGroupIds = (memberships ?? [])
    .filter((m) => roleAtLeast(m.role as GroupRole, 'admin'))
    .map((m) => m.group_id)

  if (adminGroupIds.length) {
    const { data: pending } = await supabase
      .from('chapter_contributions')
      .select('id, chapter_id, author_name, kind, created_at, group_id')
      .in('group_id', adminGroupIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20)

    const chapterIds = [
      ...new Set((pending ?? []).map((p) => p.chapter_id)),
    ]
    const chapterMeta = new Map<
      string,
      { title: string; bookId: string }
    >()
    if (chapterIds.length) {
      const { data: chapters } = await supabase
        .from('chapters')
        .select('id, title, book_id')
        .in('id', chapterIds)
      for (const c of chapters ?? []) {
        chapterMeta.set(c.id, { title: c.title, bookId: c.book_id })
      }
    }
    const bookIds2 = [
      ...new Set([...chapterMeta.values()].map((c) => c.bookId)),
    ]
    const shareByBook = new Map<string, string | null>()
    if (bookIds2.length) {
      const { data: books } = await supabase
        .from('books')
        .select('id, share_token, is_public')
        .in('id', bookIds2)
      for (const b of books ?? []) {
        shareByBook.set(
          b.id,
          b.is_public && b.share_token ? b.share_token : null,
        )
      }
    }

    for (const p of pending ?? []) {
      const ch = chapterMeta.get(p.chapter_id)
      const token = ch ? shareByBook.get(ch.bookId) : null
      items.push({
        id: `contrib-${p.id}`,
        kind: 'contribution_pending',
        title: 'Onay bekleyen katkı',
        body: `${p.author_name} · ${p.kind} · ${ch?.title || 'ünite'}`,
        href: token
          ? `/s/${token}/chapters/${p.chapter_id}`
          : ch
            ? `/books/${ch.bookId}/chapters/${p.chapter_id}`
            : '/',
        createdAt: p.created_at,
      })
    }
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
