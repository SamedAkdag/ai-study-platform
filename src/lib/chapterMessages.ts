import { supabase } from './supabase'
import { currentUserId } from './authSession'
import type { Message } from '@/types/database'

export async function fetchChapterMessages(
  chapterId: string,
  limit = 40,
): Promise<Message[]> {
  try {
    const userId = await currentUserId()
    let q = supabase
      .from('messages')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true })
      .limit(limit)
    if (userId) q = q.eq('user_id', userId)

    const { data, error } = await q
    if (error) {
      console.warn('messages fetch failed', error)
      return []
    }
    return (data ?? []) as Message[]
  } catch {
    return []
  }
}

/** Save a user question + assistant answer pair. */
export async function saveChapterExchange(input: {
  chapterId: string
  question: string
  answer: string
  selectionQuote?: string
}): Promise<void> {
  try {
    const userId = await currentUserId()
    const quote = input.selectionQuote?.trim().slice(0, 500) || null
    const { error } = await supabase.from('messages').insert([
      {
        chapter_id: input.chapterId,
        user_id: userId,
        role: 'user' as const,
        content: input.question,
        selection_quote: quote,
      },
      {
        chapter_id: input.chapterId,
        user_id: userId,
        role: 'assistant' as const,
        content: input.answer,
        selection_quote: quote,
      },
    ])
    if (error) console.warn('messages insert failed', error)
  } catch (err) {
    console.warn('messages save failed', err)
  }
}
