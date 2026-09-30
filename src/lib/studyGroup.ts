import { supabase } from './supabase'
import {
  getOrCreateMemberKey,
  getStoredDisplayName,
  setStoredDisplayName,
} from './memberIdentity'
import { asError, throwAsError } from './errors'
import { rememberLibraryBook } from './library'
import type {
  GroupInvite,
  GroupMember,
  GroupRole,
  InviteRole,
  StudyGroup,
} from '@/types/database'

function makeToken(len = 16) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, len)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

const ROLE_RANK: Record<GroupRole, number> = {
  read: 1,
  write: 2,
  admin: 3,
  owner: 4,
}

export function roleAtLeast(role: GroupRole | null | undefined, min: GroupRole) {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export function roleLabel(role: GroupRole | InviteRole) {
  if (role === 'owner') return 'Sahip'
  if (role === 'admin') return 'Admin'
  if (role === 'write') return 'Yazma'
  return 'Okuma'
}

export async function ensureStudyGroup(bookId: string): Promise<StudyGroup> {
  const { data: existing, error: findError } = await supabase
    .from('study_groups')
    .select('*')
    .eq('book_id', bookId)
    .maybeSingle()
  if (findError) throw findError
  if (existing) return existing as StudyGroup

  const { data, error } = await supabase
    .from('study_groups')
    .insert({ book_id: bookId })
    .select('*')
    .single()
  if (error) throw error
  return data as StudyGroup
}

export async function ensureOwnerMembership(groupId: string, displayName?: string) {
  const memberKey = getOrCreateMemberKey()
  const name =
    (displayName && setStoredDisplayName(displayName)) ||
    getStoredDisplayName() ||
    setStoredDisplayName('Sahip')

  const { data: existing, error: findError } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .eq('member_key', memberKey)
    .maybeSingle()
  if (findError) throw findError
  if (existing) return existing as GroupMember

  const { data, error } = await supabase
    .from('group_members')
    .insert({
      group_id: groupId,
      member_key: memberKey,
      display_name: name,
      role: 'owner',
      user_id: (await supabase.auth.getSession()).data.session?.user?.id ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as GroupMember
}

export async function fetchStudyGroupByBook(bookId: string) {
  const { data, error } = await supabase
    .from('study_groups')
    .select('*')
    .eq('book_id', bookId)
    .maybeSingle()
  if (error) throw error
  return data as StudyGroup | null
}

export async function fetchGroupMembers(groupId: string) {
  const { data, error } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as GroupMember[]
}

export async function fetchGroupInvites(groupId: string) {
  const { data, error } = await supabase
    .from('group_invites')
    .select('*')
    .eq('group_id', groupId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GroupInvite[]
}

export async function fetchMyMembership(groupId: string) {
  const memberKey = getOrCreateMemberKey()

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const userId = session?.user?.id

  if (userId) {
    const { data: byUserRows, error: userError } = await supabase
      .from('group_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
      .limit(1)
    if (userError) throwAsError(userError)
    const byUser = byUserRows?.[0]
    if (byUser) return byUser as GroupMember
  }

  const { data: byKeyRows, error } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .eq('member_key', memberKey)
    .order('joined_at', { ascending: true })
    .limit(1)
  if (error) throwAsError(error)

  const data = byKeyRows?.[0] ?? null

  if (data && userId && !(data as GroupMember).user_id) {
    const { data: linked, error: linkError } = await supabase
      .from('group_members')
      .update({ user_id: userId })
      .eq('id', data.id)
      .select('*')
      .single()
    if (!linkError && linked) return linked as GroupMember
  }

  return data as GroupMember | null
}

export async function createGroupInvite(input: {
  groupId: string
  role: InviteRole
  label?: string
}) {
  const { data, error } = await supabase
    .from('group_invites')
    .insert({
      group_id: input.groupId,
      token: makeToken(18),
      role: input.role,
      label: input.label?.trim() || null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as GroupInvite
}

export async function revokeGroupInvite(inviteId: string) {
  const { error } = await supabase
    .from('group_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
  if (error) throw error
}

export async function updateMemberRole(
  memberId: string,
  role: Exclude<GroupRole, 'owner'>,
) {
  const { data, error } = await supabase
    .from('group_members')
    .update({ role })
    .eq('id', memberId)
    .neq('role', 'owner')
    .select('*')
    .single()
  if (error) throw error
  return data as GroupMember
}

export async function removeGroupMember(memberId: string) {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('id', memberId)
    .neq('role', 'owner')
  if (error) throw error
}

export type InvitePreview = {
  invite: GroupInvite
  group: StudyGroup
  book: { id: string; title: string; share_token: string | null; is_public: boolean | null }
}

export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const { data: invite, error: inviteError } = await supabase
    .from('group_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (inviteError) throw inviteError
  if (!invite || invite.revoked_at) throw new Error('Davet geçersiz veya iptal edilmiş')
  if (invite.max_uses != null && invite.use_count >= invite.max_uses) {
    throw new Error('Bu davetin kullanım limiti dolmuş')
  }

  const { data: group, error: groupError } = await supabase
    .from('study_groups')
    .select('*')
    .eq('id', invite.group_id)
    .maybeSingle()
  if (groupError) throw groupError
  if (!group) throw new Error('Grup bulunamadı')

  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id, title, share_token, is_public')
    .eq('id', group.book_id)
    .maybeSingle()
  if (bookError) throw bookError
  if (!book) throw new Error('Kitap bulunamadı')

  return {
    invite: invite as GroupInvite,
    group: group as StudyGroup,
    book,
  }
}

export async function acceptGroupInvite(input: {
  token: string
  displayName: string
}) {
  try {
    const preview = await fetchInvitePreview(input.token)
    const name = setStoredDisplayName(input.displayName)
    if (!name) throw new Error('Görünen ad gerekli')

    const pin = () =>
      rememberLibraryBook({
        bookId: preview.book.id,
        title: preview.book.title,
        shareToken: preview.book.share_token,
        source: 'group',
      })

    const memberKey = getOrCreateMemberKey()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null

    const existing = await fetchMyMembership(preview.group.id)

    if (existing) {
      if (existing.role === 'owner') {
        pin()
        return {
          member: existing,
          book: preview.book,
          group: preview.group,
        }
      }
      const nextRole =
        ROLE_RANK[preview.invite.role] > ROLE_RANK[existing.role]
          ? preview.invite.role
          : existing.role
      const { data, error } = await supabase
        .from('group_members')
        .update({
          role: nextRole,
          display_name: name,
          invite_id: preview.invite.id,
          ...(userId && !existing.user_id ? { user_id: userId } : {}),
        })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throwAsError(error, 'Üyelik güncellenemedi')
      await bumpInviteUse(preview.invite)
      pin()
      return {
        member: data as GroupMember,
        book: preview.book,
        group: preview.group,
      }
    }

    const row = {
      group_id: preview.group.id,
      member_key: memberKey,
      display_name: name,
      role: preview.invite.role,
      invite_id: preview.invite.id,
      user_id: userId,
    }

    const { data: member, error: memberError } = await supabase
      .from('group_members')
      .upsert(row, { onConflict: 'group_id,member_key' })
      .select('*')
      .single()

    if (memberError) {
      if (memberError.code === '23505') {
        const again = await fetchMyMembership(preview.group.id)
        if (again) {
          await bumpInviteUse(preview.invite)
          pin()
          return {
            member: again,
            book: preview.book,
            group: preview.group,
          }
        }
      }
      throwAsError(memberError, 'Gruba eklenemedi')
    }

    await bumpInviteUse(preview.invite)
    pin()

    return {
      member: member as GroupMember,
      book: preview.book,
      group: preview.group,
    }
  } catch (err) {
    throw asError(err, 'Katılım başarısız')
  }
}

async function bumpInviteUse(invite: GroupInvite) {
  const { error } = await supabase
    .from('group_invites')
    .update({ use_count: (invite.use_count ?? 0) + 1 })
    .eq('id', invite.id)
  if (error) {
    // Non-fatal: membership already created
    console.warn('invite use_count bump failed', error.message)
  }
}

/** Ensure group + owner when public share is turned on. */
export async function bootstrapBookGroup(bookId: string) {
  const group = await ensureStudyGroup(bookId)
  await ensureOwnerMembership(group.id)
  return group
}

/**
 * Public book link → join (or keep) as read member so chat becomes available.
 * Does not upgrade existing higher roles.
 */
export async function joinPublicBookAsReader(
  bookId: string,
  displayName?: string,
): Promise<GroupMember> {
  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id, is_public, share_token, title')
    .eq('id', bookId)
    .maybeSingle()
  if (bookError) throw bookError
  if (!book?.is_public || !book.share_token) {
    throw new Error('Bu çalışma private — gruba yalnızca davetle katılınır.')
  }

  const group = await ensureStudyGroup(bookId)
  const memberKey = getOrCreateMemberKey()
  const name =
    (displayName && setStoredDisplayName(displayName)) ||
    getStoredDisplayName() ||
    setStoredDisplayName('Okuyucu')

  const { data: existing, error: findError } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', group.id)
    .eq('member_key', memberKey)
    .maybeSingle()
  if (findError) throw findError
  if (existing) return existing as GroupMember

  const userId =
    (await supabase.auth.getSession()).data.session?.user?.id ?? null

  const { data, error } = await supabase
    .from('group_members')
    .insert({
      group_id: group.id,
      member_key: memberKey,
      display_name: name,
      role: 'read',
      user_id: userId,
    })
    .select('*')
    .single()
  if (error) throwAsError(error, 'Gruba katılım başarısız')

  rememberLibraryBook({
    bookId,
    title: book.title,
    shareToken: book.share_token,
    source: 'group',
  })
  return data as GroupMember
}
