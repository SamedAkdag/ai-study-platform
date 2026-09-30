// Step 2: group micro-topics into ~5-page study units by topical relatedness.
// Secrets: TOKENHARBOR_API_KEY (MiMo required)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmComplete, safeParseJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type MicroIn = {
  index: number
  start_page: number
  end_page: number
  title: string
  summary?: string
}

type UnitOut = {
  title: string
  summary?: string
  micro_indexes: number[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { apiKey: mimoKey } = getMimoConfig()
    if (!mimoKey) {
      throw new Error(
        'TOKENHARBOR_API_KEY missing in Edge secrets — MiMo is required',
      )
    }

    const body = await req.json()
    const bookTitle = (body?.book_title as string) || 'Textbook'
    const micros = (body?.micro_topics ?? []) as MicroIn[]

    if (!Array.isArray(micros) || micros.length === 0) {
      return new Response(JSON.stringify({ error: 'micro_topics[] required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const catalog = micros
      .map((m) => {
        const pages = m.end_page - m.start_page + 1
        return `#${m.index} | s.${m.start_page}–${m.end_page} (${pages}p) | ${m.title}${
          m.summary ? ` — ${m.summary}` : ''
        }`
      })
      .join('\n')

    const system = `You group MICRO-TOPICS into STUDY UNITS for a textbook.

Return JSON only:
{"units":[{"title":"umbrella unit title","summary":"1 sentence","micro_indexes":[0,1,2]}]}

GOALS:
- Each unit should total about 5 pages (acceptable 4–7). Prefer ~5.
- Group ONLY consecutive micro-topics (indexes must stay in ascending order, no reordering / no skipping mid-range).
- Group by topical relatedness: same chapter theme / continuing argument stays together.
- Do NOT split one micro-topic across units.
- If a single micro is already 4–7 pages, it can be its own unit.
- If a micro is 1–2 pages, combine with neighbors when they are related until ~5 pages.
- unit title = clean umbrella TOC name (not a full sentence).
- Cover EVERY micro_index exactly once (no duplicates, no omissions).
- Use the book's language.`

    const user = `Book: ${bookTitle}

Micro-topics (in page order):
${catalog}

Pack them into ~5-page related units.`

    const { text } = await llmComplete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      json: false,
      temperature: 0.2,
      maxTokens: 2200,
    })

    const parsed = safeParseJson(text) as { units?: UnitOut[] }
    const units = Array.isArray(parsed.units) ? parsed.units : []

    return new Response(JSON.stringify({ units }), {
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
