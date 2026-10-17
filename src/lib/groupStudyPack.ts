import { supabase } from './supabase'
import type { GroupMember, StudyGroup } from '@/types/database'
import { fetchGroupMembers } from './studyGroup'

export type GroupFocus = {
  chapterId: string | null
  note: string | null
  setBy: string | null
  updatedAt: string | null
}

export type MemberQuizRow = {
  memberId: string
  displayName: string
  userId: string | null
  score: number | null
  total: number | null
  at: string | null
}

export function focusFromGroup(group: StudyGroup): GroupFocus {
  return {
    chapterId: group.focus_chapter_id ?? null,
    note: group.focus_note ?? null,
    setBy: group.focus_set_by ?? null,
    updatedAt: group.focus_updated_at ?? null,
  }
}

export async function setGroupFocus(input: {
  groupId: string
  chapterId: string
  note?: string
  setBy: string
}): Promise<StudyGroup> {
  const { data, error } = await supabase
    .from('study_groups')
    .update({
      focus_chapter_id: input.chapterId,
      focus_note: input.note?.trim() || null,
      focus_set_by: input.setBy.trim().slice(0, 80),
      focus_updated_at: new Date().toISOString(),
    })
    .eq('id', input.groupId)
    .select('*')
    .single()
  if (error) throw error
  return data as StudyGroup
}

export async function clearGroupFocus(groupId: string): Promise<StudyGroup> {
  const { data, error } = await supabase
    .from('study_groups')
    .update({
      focus_chapter_id: null,
      focus_note: null,
      focus_set_by: null,
      focus_updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .select('*')
    .single()
  if (error) throw error
  return data as StudyGroup
}

/**
 * Latest quiz attempt per group member (who has user_id) for a chapter.
 */
export async function fetchGroupQuizBoard(
  groupId: string,
  chapterId: string,
): Promise<MemberQuizRow[]> {
  const members = await fetchGroupMembers(groupId)
  const withUser = members.filter((m) => m.user_id)
  if (!withUser.length) {
    return members.map((m) => emptyRow(m))
  }

  const userIds = withUser.map((m) => m.user_id!)
  const { data, error } = await supabase
    .from('quiz_results')
    .select('user_id, score, total, created_at')
    .eq('chapter_id', chapterId)
    .in('user_id', userIds)
    .order('created_at', { ascending: false })
    .limit(120)

  if (error) {
    console.warn('group quiz board failed', error)
    return members.map((m) => emptyRow(m))
  }

  const latest = new Map<
    string,
    { score: number; total: number; at: string }
  >()
  for (const row of data ?? []) {
    if (!row.user_id || latest.has(row.user_id)) continue
    latest.set(row.user_id, {
      score: row.score,
      total: row.total,
      at: row.created_at,
    })
  }

  return members.map((m) => {
    const hit = m.user_id ? latest.get(m.user_id) : undefined
    return {
      memberId: m.id,
      displayName: m.display_name,
      userId: m.user_id,
      score: hit?.score ?? null,
      total: hit?.total ?? null,
      at: hit?.at ?? null,
    }
  })
}

function emptyRow(m: GroupMember): MemberQuizRow {
  return {
    memberId: m.id,
    displayName: m.display_name,
    userId: m.user_id,
    score: null,
    total: null,
    at: null,
  }
}
