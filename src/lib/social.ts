import { supabase } from './supabase'
import type { Profile, Friendship, StudyShare, StudyFocus } from '@/types/database'

const USERNAME_RE = /^[a-z0-9_]{3,24}$/

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export function validateUsername(username: string) {
  if (!USERNAME_RE.test(username)) {
    throw new Error(
      'Kullanıcı adı 3–24 karakter; sadece a-z, 0-9 ve alt çizgi (_)',
    )
  }
}

export async function isUsernameAvailable(username: string) {
  const u = normalizeUsername(username)
  validateUsername(u)
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('username', u)
    .maybeSingle()
  if (error) throw error
  return !data
}

export async function upsertMyProfile(input: {
  userId: string
  username: string
  displayName: string
  bio?: string
}) {
  const username = normalizeUsername(input.username)
  validateUsername(username)
  const display_name = input.displayName.trim().slice(0, 48) || username

  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (existing) {
    if (existing.username !== username) {
      const free = await isUsernameAvailable(username)
      if (!free) throw new Error('Bu kullanıcı adı alınmış')
    }
    const { data, error } = await supabase
      .from('profiles')
      .update({
        username,
        display_name,
        bio: input.bio?.trim() || existing.bio,
      })
      .eq('user_id', input.userId)
      .select('*')
      .single()
    if (error) throw error
    return data as Profile
  }

  const free = await isUsernameAvailable(username)
  if (!free) throw new Error('Bu kullanıcı adı alınmış')

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      user_id: input.userId,
      username,
      display_name,
      bio: input.bio?.trim() || null,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Bu kullanıcı adı alınmış')
    throw error
  }
  return data as Profile
}

export async function fetchMyProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function findProfileByUsername(username: string) {
  const u = normalizeUsername(username)
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', u)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function searchProfiles(query: string, excludeUserId?: string) {
  const q = normalizeUsername(query)
  if (q.length < 2) return []
  let req = supabase
    .from('profiles')
    .select('*')
    .ilike('username', `${q}%`)
    .limit(12)
  if (excludeUserId) req = req.neq('user_id', excludeUserId)
  const { data, error } = await req
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function sendFriendRequest(fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) throw new Error('Kendine istek atamazsın')

  const { data: reverse } = await supabase
    .from('friendships')
    .select('*')
    .eq('requester_id', toUserId)
    .eq('addressee_id', fromUserId)
    .maybeSingle()

  if (reverse?.status === 'accepted') return reverse as Friendship
  if (reverse?.status === 'pending') {
    const { data, error } = await supabase
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', reverse.id)
      .select('*')
      .single()
    if (error) throw error
    return data as Friendship
  }

  const { data, error } = await supabase
    .from('friendships')
    .insert({
      requester_id: fromUserId,
      addressee_id: toUserId,
      status: 'pending',
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Zaten istek var veya arkadaşsınız')
    throw error
  }
  return data as Friendship
}

export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean,
) {
  const { data, error } = await supabase
    .from('friendships')
    .update({
      status: accept ? 'accepted' : 'declined',
      updated_at: new Date().toISOString(),
    })
    .eq('id', friendshipId)
    .select('*')
    .single()
  if (error) throw error
  return data as Friendship
}

export async function fetchFriendships(userId: string) {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Friendship[]
}

export async function fetchProfilesByIds(ids: string[]) {
  if (!ids.length) return [] as Profile[]
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('user_id', ids)
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function listAcceptedFriends(userId: string) {
  const rows = await fetchFriendships(userId)
  const accepted = rows.filter((f) => f.status === 'accepted')
  const otherIds = accepted.map((f) =>
    f.requester_id === userId ? f.addressee_id : f.requester_id,
  )
  const profiles = await fetchProfilesByIds(otherIds)
  return profiles
}

export async function sendStudyShare(input: {
  fromUserId: string
  toUserId: string
  bookId: string
  note?: string
}) {
  const { data, error } = await supabase
    .from('study_shares')
    .insert({
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      book_id: input.bookId,
      note: input.note?.trim()?.slice(0, 280) || null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as StudyShare
}

export async function fetchInboxShares(userId: string) {
  const { data, error } = await supabase
    .from('study_shares')
    .select('*')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) throw error
  return (data ?? []) as StudyShare[]
}

export async function markShareRead(shareId: string) {
  const { error } = await supabase
    .from('study_shares')
    .update({ read_at: new Date().toISOString() })
    .eq('id', shareId)
  if (error) throw error
}

export async function bumpStudyFocus(input: {
  userId: string
  bookId: string
  chapterId?: string | null
  seconds: number
}) {
  if (input.seconds <= 0) return
  const { error } = await supabase.rpc('bump_study_focus', {
    p_user_id: input.userId,
    p_book_id: input.bookId,
    p_chapter_id: input.chapterId ?? null,
    p_seconds: input.seconds,
  })
  if (error) throw error
}

export async function fetchMyStudyFocus(userId: string, days = 30) {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  const sinceDay = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('study_focus')
    .select('*')
    .eq('user_id', userId)
    .gte('day', sinceDay)
    .order('day', { ascending: false })
  if (error) throw error
  return (data ?? []) as StudyFocus[]
}

export function computeStreak(rows: StudyFocus[]) {
  const days = new Set(rows.filter((r) => r.seconds > 0).map((r) => r.day))
  let streak = 0
  const cursor = new Date()
  for (;;) {
    const key = cursor.toISOString().slice(0, 10)
    if (!days.has(key)) break
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}
