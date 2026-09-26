// Selection-scoped tutor chat for a chapter explanation passage.
// Uses selected text + ~10 preceding lines only — does not use the rest of the book.
// Secrets: GROQ_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'qwen/qwen3.8-27b'
const MAX_RETRIES = 4

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseRetryMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)\s*s/i)
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500
  return 15_000
}

type HistoryItem = { role: 'user' | 'assistant'; content: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) throw new Error('GROQ_API_KEY is not set')

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
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${contextBlock}\n\n(Remember: stay inside this passage only.)`,
      },
      ...history.slice(-8).map((h) => ({
        role: h.role,
        content: h.content,
      })),
      { role: 'user', content: question },
    ]

    let answer = ''
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.3,
          reasoning_effort: 'none',
          max_tokens: 700,
          messages,
        }),
      })

      if (res.status === 429) {
        const errBody = await res.text()
        if (attempt === MAX_RETRIES) throw new Error(`Groq error 429: ${errBody}`)
        await sleep(parseRetryMs(errBody))
        continue
      }

      if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`)

      const payload = await res.json()
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('Empty Groq response')
      answer = content
      break
    }

    return new Response(JSON.stringify({ answer }), {
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
