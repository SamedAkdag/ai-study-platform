// Names study units with topic titles + short descriptions.
// One batched call (chunked client-side). Secrets: GROQ_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'qwen/qwen3.8-27b'
const MAX_RETRIES = 4

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type UnitIn = {
  index: number
  start_page: number
  end_page: number
  excerpt: string
}

type UnitOut = {
  index: number
  title: string
  summary: string
  key_concepts?: string[]
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseRetryMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)\s*s/i)
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500
  return 15_000
}

function stripMarkdownJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function safeParseJson(raw: string): unknown {
  const cleaned = stripMarkdownJson(raw)
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('AI response was not valid JSON')
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) throw new Error('GROQ_API_KEY is not set')

    const body = await req.json()
    const bookTitle = (body?.book_title as string) || 'Textbook'
    const units = (body?.units ?? []) as UnitIn[]

    if (!Array.isArray(units) || units.length === 0) {
      return new Response(JSON.stringify({ error: 'units[] required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const catalog = units
      .map(
        (u) =>
          `UNIT ${u.index} (pages ${u.start_page}-${u.end_page}):\n${(u.excerpt || '').slice(0, 900)}`,
      )
      .join('\n\n---\n\n')

    const system = `You name textbook STUDY UNITS for a table of contents.
Return JSON only:
{"units":[{"index":number,"title":"short topic title","summary":"1 sentence what this unit covers","key_concepts":["up to 3"]}]}

Rules:
- title = clear TOPIC name (e.g. "Limitler ve Süreklilik"), NOT "Content for pages…", NOT raw first sentence fragments, NOT page numbers.
- Prefer the book's language.
- summary = one plain sentence about what the student will study.
- Keep titles concise (3–8 words).
- One output object per input unit index. Do not invent units.`

    const user = `Book: ${bookTitle}\n\nName these units:\n\n${catalog}`

    let named: UnitOut[] = []

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          reasoning_effort: 'none',
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
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

      const parsed = safeParseJson(content) as { units?: UnitOut[] }
      named = Array.isArray(parsed.units) ? parsed.units : []
      break
    }

    return new Response(JSON.stringify({ units: named }), {
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
