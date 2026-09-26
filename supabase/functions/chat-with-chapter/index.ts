// Selection-scoped tutor chat.
// Secrets: GROQ_API_KEY (primary), GEMINI_API_KEY (fallback)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmComplete } from '../_shared/llm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type HistoryItem = { role: 'user' | 'assistant'; content: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!Deno.env.get('GROQ_API_KEY') && !Deno.env.get('GEMINI_API_KEY')) {
      throw new Error('Set GROQ_API_KEY and/or GEMINI_API_KEY')
    }

    const body = await req.json()
    const chapterTitle = (body?.chapter_title as string) || 'this unit'
    const selectedText = (body?.selected_text as string) || ''
    const precedingContext = (body?.preceding_context as string) || ''
    const question = (body?.question as string) || ''
    const history = (Array.isArray(body?.history) ? body.history : []) as HistoryItem[]

    if (!selectedText.trim() || !question.trim()) {
      return new Response(
        JSON.stringify({ error: 'selected_text and question required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const system = `You are a tutor helping a student with the study unit "${chapterTitle}".
Answer ONLY using the SELECTED PASSAGE and the SHORT PRECEDING CONTEXT (~10 lines before the selection).
Do NOT use knowledge from other chapters or invent facts not supported by this context.
If the answer is not in this context, say so honestly in the student's language.
Keep answers concise and clear. Match the language of the student's question.`

    const contextBlock = `PRECEDING CONTEXT (~10 lines before selection):
${precedingContext || '(none)'}

SELECTED PASSAGE:
${selectedText}`

    const messages = [
      { role: 'system' as const, content: system },
      {
        role: 'user' as const,
        content: `${contextBlock}\n\n(Remember: stay inside this passage only.)`,
      },
      ...history.slice(-8).map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: question },
    ]

    const { text: answer, provider } = await llmComplete({
      messages,
      temperature: 0.3,
      maxTokens: 700,
    })

    return new Response(JSON.stringify({ answer, provider }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
