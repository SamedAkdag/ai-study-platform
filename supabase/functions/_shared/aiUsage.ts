// Persist per-operation LLM token usage for the study workspace panel.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  addTokenUsage,
  emptyUsage,
  type LlmResult,
  type TokenUsage,
} from './llm.ts'
import { getMimoConfig } from './mimo.ts'

export type AiUsageOperation =
  | 'chapter_notes'
  | 'artifact_brief'
  | 'artifact_detailed'
  | 'artifact_practice'
  | 'artifact_mind_map'
  | 'chapter_chat'
  | 'segment'
  | 'pack'
  | 'other'

export type UsageBag = {
  usage: TokenUsage
  provider: LlmResult['provider'] | null
  calls: number
}

export function createUsageBag(): UsageBag {
  return { usage: emptyUsage(), provider: null, calls: 0 }
}

export function recordUsage(
  bag: UsageBag,
  usage: TokenUsage | undefined | null,
  provider?: LlmResult['provider'],
) {
  if (!usage) return
  bag.usage = addTokenUsage(bag.usage, usage)
  bag.calls += 1
  if (provider) bag.provider = provider
}

export async function resolveBookContext(
  admin: SupabaseClient,
  chapterId: string,
): Promise<{ bookId: string | null; userId: string | null }> {
  const { data: chapter } = await admin
    .from('chapters')
    .select('book_id')
    .eq('id', chapterId)
    .maybeSingle()

  const bookId = (chapter?.book_id as string | undefined) || null
  if (!bookId) return { bookId: null, userId: null }

  const { data: book } = await admin
    .from('books')
    .select('user_id')
    .eq('id', bookId)
    .maybeSingle()

  return {
    bookId,
    userId: (book?.user_id as string | undefined) || null,
  }
}

export async function logAiUsage(
  admin: SupabaseClient,
  input: {
    operation: AiUsageOperation
    bookId?: string | null
    chapterId?: string | null
    userId?: string | null
    bag: UsageBag
    meta?: Record<string, unknown>
  },
): Promise<void> {
  const { bag } = input
  if (bag.calls === 0 && bag.usage.total_tokens === 0) return

  const { model } = getMimoConfig()
  const provider = bag.provider || 'mimo'

  const { error } = await admin.from('ai_usage_events').insert({
    book_id: input.bookId ?? null,
    chapter_id: input.chapterId ?? null,
    user_id: input.userId ?? null,
    operation: input.operation,
    provider,
    model: provider === 'mimo' ? model : provider,
    prompt_tokens: bag.usage.prompt_tokens,
    completion_tokens: bag.usage.completion_tokens,
    total_tokens: bag.usage.total_tokens,
    cached_tokens: bag.usage.cached_tokens || 0,
    estimated: bag.usage.estimated,
    meta: {
      calls: bag.calls,
      prompt_miss_tokens: Math.max(
        0,
        bag.usage.prompt_tokens - (bag.usage.cached_tokens || 0),
      ),
      ...(input.meta || {}),
    },
  })

  if (error) {
    console.warn('ai_usage_events insert failed', error.message)
  }
}
