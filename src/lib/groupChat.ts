import { supabase } from './supabase'
import type { GroupMember, GroupMessage, GroupRole } from '@/types/database'

export async function fetchGroupMessages(input: {
  groupId: string
  chapterId?: string | null
  limit?: number
}) {
  let q = supabase
    .from('group_messages')
    .select('*')
    .eq('group_id', input.groupId)
    .order('created_at', { ascending: true })
    .limit(input.limit ?? 200)

  if (input.chapterId) {
    q = q.eq('chapter_id', input.chapterId)
  } else {
    q = q.is('chapter_id', null)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as GroupMessage[]
}

export async function postGroupMessage(input: {
  groupId: string
  chapterId?: string | null
  member: GroupMember
  body: string
}) {
  const body = input.body.replace(/\s+/g, ' ').trim().slice(0, 2000)
  if (!body) throw new Error('Mesaj boş olamaz')

  const { data, error } = await supabase
    .from('group_messages')
    .insert({
      group_id: input.groupId,
      chapter_id: input.chapterId ?? null,
      member_id: input.member.id,
      author_name: input.member.display_name,
      author_role: input.member.role,
      body,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as GroupMessage
}

export async function deleteGroupMessage(messageId: string) {
  const { error } = await supabase
    .from('group_messages')
    .delete()
    .eq('id', messageId)
  if (error) throw error
}

export function canDeleteGroupMessage(
  me: GroupMember | null | undefined,
  message: GroupMessage,
) {
  if (!me) return false
  if (me.role === 'owner' || me.role === 'admin') return true
  return me.id === message.member_id
}

export function formatMessageTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('tr-TR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function shortRole(role: GroupRole) {
  if (role === 'owner') return 'sahip'
  if (role === 'admin') return 'admin'
  if (role === 'write') return 'yazma'
  return 'okuma'
}
