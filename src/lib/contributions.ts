import { supabase } from './supabase'
import type {
  ChapterContribution,
  ContributionKind,
  ContributionStatus,
  ExampleItem,
  GroupMember,
  GroupRole,
  QuizItem,
} from '@/types/database'
import { roleAtLeast } from './studyGroup'

export type QuizPayload = QuizItem
export type ExamplePayload = ExampleItem
export type ExplanationPayload = {
  depth: 'brief' | 'standard' | 'detailed'
  markdown: string
  title?: string
}

function autoApprove(role: GroupRole) {
  return role === 'owner' || role === 'admin'
}

export async function submitContribution(input: {
  groupId: string
  chapterId: string
  member: GroupMember
  kind: ContributionKind
  payload: QuizPayload | ExamplePayload | ExplanationPayload
}) {
  const status: ContributionStatus = autoApprove(input.member.role)
    ? 'approved'
    : 'pending'

  const { data, error } = await supabase
    .from('chapter_contributions')
    .insert({
      group_id: input.groupId,
      chapter_id: input.chapterId,
      member_id: input.member.id,
      author_name: input.member.display_name,
      kind: input.kind,
      payload: input.payload as never,
      status,
      reviewed_by: status === 'approved' ? input.member.id : null,
      reviewed_at: status === 'approved' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()
  if (error) throw error

  const contrib = data as ChapterContribution
  if (contrib.status === 'approved') {
    await applyContributionToChapter(contrib)
  }
  return contrib
}

export async function fetchContributions(input: {
  chapterId: string
  status?: ContributionStatus
}) {
  let q = supabase
    .from('chapter_contributions')
    .select('*')
    .eq('chapter_id', input.chapterId)
    .order('created_at', { ascending: false })

  if (input.status) q = q.eq('status', input.status)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ChapterContribution[]
}

export async function reviewContribution(input: {
  contributionId: string
  reviewer: GroupMember
  status: 'approved' | 'rejected'
  note?: string
}) {
  if (!roleAtLeast(input.reviewer.role, 'admin')) {
    throw new Error('Sadece admin / sahip onaylayabilir')
  }

  const { data: existing, error: findError } = await supabase
    .from('chapter_contributions')
    .select('*')
    .eq('id', input.contributionId)
    .maybeSingle()
  if (findError) throw findError
  if (!existing) throw new Error('Katkı bulunamadı')
  if (existing.status !== 'pending') throw new Error('Bu katkı zaten incelendi')

  const { data, error } = await supabase
    .from('chapter_contributions')
    .update({
      status: input.status,
      review_note: input.note?.trim() || null,
      reviewed_by: input.reviewer.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.contributionId)
    .select('*')
    .single()
  if (error) throw error

  const contrib = data as ChapterContribution
  if (contrib.status === 'approved') {
    await applyContributionToChapter(contrib)
  }
  return contrib
}

export async function applyContributionToChapter(contrib: ChapterContribution) {
  const { data: chapter, error: chError } = await supabase
    .from('chapters')
    .select('id, quiz, examples, explanation, explanation_brief, explanation_detailed')
    .eq('id', contrib.chapter_id)
    .single()
  if (chError) throw chError

  if (contrib.kind === 'quiz') {
    const item = normalizeQuiz(contrib.payload as QuizPayload)
    const quiz = [...((chapter.quiz as QuizItem[] | null) ?? []), item]
    const { error } = await supabase
      .from('chapters')
      .update({ quiz })
      .eq('id', chapter.id)
    if (error) throw error
    return
  }

  if (contrib.kind === 'example') {
    const item = contrib.payload as ExamplePayload
    const examples = [
      ...((chapter.examples as ExampleItem[] | null) ?? []),
      {
        problem: String(item.problem || '').trim(),
        solution_steps: Array.isArray(item.solution_steps)
          ? item.solution_steps.map((s) => String(s).trim()).filter(Boolean)
          : [],
      },
    ]
    const { error } = await supabase
      .from('chapters')
      .update({ examples })
      .eq('id', chapter.id)
    if (error) throw error
    return
  }

  if (contrib.kind === 'explanation') {
    const p = contrib.payload as ExplanationPayload
    const block = formatExplanationBlock(p)
    const patch =
      p.depth === 'brief'
        ? { explanation_brief: appendBlock(chapter.explanation_brief, block) }
        : p.depth === 'detailed'
          ? {
              explanation_detailed: appendBlock(
                chapter.explanation_detailed,
                block,
              ),
            }
          : { explanation: appendBlock(chapter.explanation, block) }
    const { error } = await supabase
      .from('chapters')
      .update(patch)
      .eq('id', chapter.id)
    if (error) throw error
  }
}

function appendBlock(prev: string | null | undefined, block: string) {
  const base = String(prev ?? '').trim()
  return base ? `${base}\n\n${block}` : block
}

function formatExplanationBlock(p: ExplanationPayload) {
  const title = (p.title || 'Grup katkısı').trim()
  const body = String(p.markdown || '').trim()
  return `> **${title}**\n>\n${body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}`
}

export function normalizeQuiz(raw: Partial<QuizItem>): QuizItem {
  const type = raw.type || 'mcq'
  const question = String(raw.question || '').trim()
  const explanation = String(raw.explanation || '').trim()

  if (type === 'true_false') {
    return {
      type: 'true_false',
      question,
      options: ['Doğru', 'Yanlış'],
      correct_index: raw.correct_index === 1 ? 1 : 0,
      explanation,
    }
  }

  if (type === 'short') {
    return {
      type: 'short',
      question,
      options: [],
      correct_index: -1,
      correct_text: String(raw.correct_text || '').trim(),
      explanation,
    }
  }

  const options = Array.isArray(raw.options)
    ? raw.options.map((o) => String(o).trim()).filter(Boolean)
    : []
  const correct_index =
    typeof raw.correct_index === 'number' &&
    raw.correct_index >= 0 &&
    raw.correct_index < options.length
      ? raw.correct_index
      : 0

  return {
    type: 'mcq',
    question,
    options,
    correct_index,
    explanation,
  }
}

export function quizTypeLabel(type?: QuizItem['type']) {
  if (type === 'true_false') return 'Doğru / Yanlış'
  if (type === 'short') return 'Kısa cevap'
  return 'Çoktan seçmeli'
}
