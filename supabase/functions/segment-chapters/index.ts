// Supabase Edge Function: segment-chapters
// Receives client-extracted PDF text windows only — never parses PDFs server-side.
// Secrets: GROQ_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'qwen/qwen3.8-27b'
const MAX_OUTPUT_TOKENS = 350
const MAX_INPUT_CHARS = 8000
const MAX_RETRIES = 4

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type WindowInput = {
  windowIndex: number
  startPage: number
  endPage: number
  text: string
}

type ChapterProposal = {
  title: string
  start_page: number
  end_page: number
  summary?: string
  key_concepts?: string[]
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Strip markdown fences AI sometimes wraps around JSON. */
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

function parseRetryMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)\s*s/i)
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) + 500
  }
  return 15_000
}

async function groqChat(apiKey: string, messages: unknown[]): Promise<string> {
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
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages,
      }),
    })

    if (res.status === 429) {
      const body = await res.text()
      if (attempt === MAX_RETRIES) {
        throw new Error(`Groq error 429: ${body}`)
      }
      await sleep(parseRetryMs(body))
      continue
    }

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Groq error ${res.status}: ${body}`)
    }

    const payload = await res.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('Empty Groq response')
    }
    return content
  }

  throw new Error('Groq retries exhausted')
}

async function segmentWindow(
  apiKey: string,
  window: WindowInput,
): Promise<ChapterProposal[]> {
  const system = `You prepare STUDY UNITS for a textbook excerpt — NOT a table of contents.

Goal: about 5 pages per unit (acceptable 4–7). Multiple subheadings inside one unit is GOOD and expected.
Do NOT create a chapter per subtitle / per page.

Return JSON only:
{"chapters":[{"title":"umbrella title for the whole unit","start_page":number,"end_page":number,"summary":"max 20 words","key_concepts":["up to 3"]}]}

Rules:
- Prefer EXACTLY 1 chapter covering most/all of pages ${window.startPage}-${window.endPage}.
- Split into 2 only if there is a major subject change AND each part is at least 3 pages.
- If the last page cuts a topic mid-way, still keep one unit for this window (next window will continue it).
- Title = overarching theme (not the first H2 alone).
- Use the source language.
- If most pages have no extractable text, return {"chapters":[]} — never invent titles like "Content for Pages X-Y" or summaries like "No text provided".`

  const text =
    window.text.length > MAX_INPUT_CHARS
      ? `${window.text.slice(0, MAX_INPUT_CHARS)}\n…[truncated]`
      : window.text

  const user = `Window pages ${window.startPage}-${window.endPage} (target ~5-page study unit):\n\n${text}`

  const content = await groqChat(apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  const parsed = safeParseJson(content) as { chapters?: ChapterProposal[] }
  const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : []

  const normalized = chapters
    .filter(
      (c) =>
        c &&
        typeof c.title === 'string' &&
        typeof c.start_page === 'number' &&
        typeof c.end_page === 'number',
    )
    .map((c) => ({
      title: c.title,
      start_page: Math.max(window.startPage, Math.min(c.start_page, window.endPage)),
      end_page: Math.max(window.startPage, Math.min(c.end_page, window.endPage)),
      summary: typeof c.summary === 'string' ? c.summary.slice(0, 200) : undefined,
      key_concepts: Array.isArray(c.key_concepts)
        ? c.key_concepts.filter((x) => typeof x === 'string').slice(0, 3)
        : undefined,
    }))

  // If model still over-splits, collapse to a single window-sized unit.
  if (normalized.length === 0) {
    return [
      {
        title: `Sayfa ${window.startPage}–${window.endPage}`,
        start_page: window.startPage,
        end_page: window.endPage,
      },
    ]
  }

  const allTiny = normalized.every((c) => c.end_page - c.start_page + 1 < 3)
  if (normalized.length > 2 || allTiny) {
    return [
      {
        title: normalized[0]!.title,
        start_page: window.startPage,
        end_page: window.endPage,
        summary: normalized
          .map((c) => c.summary)
          .filter(Boolean)
          .join(' · ')
          .slice(0, 200) || undefined,
        key_concepts: normalized.flatMap((c) => c.key_concepts ?? []).slice(0, 3),
      },
    ]
  }

  return normalized
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY is not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const windows = (body?.windows ?? []) as WindowInput[]
    if (!Array.isArray(windows) || windows.length === 0) {
      return new Response(JSON.stringify({ error: 'windows[] required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Process at most a few windows per invoke (client sends batches).
    const results = []
    for (let i = 0; i < windows.length; i += 1) {
      const window = windows[i]!
      const chapters = await segmentWindow(apiKey, window)
      results.push({
        windowIndex: window.windowIndex,
        startPage: window.startPage,
        endPage: window.endPage,
        chapters,
      })
      if (i < windows.length - 1) {
        await sleep(2_500)
      }
    }

    return new Response(JSON.stringify({ windows: results }), {
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
