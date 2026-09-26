// Smart study-unit boundaries: ~5 pages with topic integrity.
// Extend if topic continues; shrink if last page starts a long spill.
// Also returns subtopic headings for the chapter list.
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

type PageIn = {
  page: number
  headings: string[]
  excerpt: string
}

type ChapterOut = {
  start_page: number
  end_page: number
  title: string
  summary: string
  subtopics: string[]
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
    const pages = (body?.pages ?? []) as PageIn[]
    const rangeStart = Number(body?.range_start ?? pages[0]?.page ?? 1)
    const rangeEnd = Number(
      body?.range_end ?? pages[pages.length - 1]?.page ?? rangeStart,
    )

    if (!Array.isArray(pages) || pages.length === 0) {
      return new Response(JSON.stringify({ error: 'pages[] required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const catalog = pages
      .map((p) => {
        const heads =
          Array.isArray(p.headings) && p.headings.length
            ? `headings: ${p.headings.join(' | ')}`
            : 'headings: (none detected)'
        return `p.${p.page} — ${heads}\n${(p.excerpt || '').slice(0, 280)}`
      })
      .join('\n\n')

    const system = `You segment a textbook into STUDY SESSIONS for students.

Return JSON only:
{"chapters":[{"start_page":n,"end_page":n,"title":"short topic name","summary":"1 sentence what student will learn","subtopics":["short topic label", "..."]}]}

GOAL: each chapter ≈ one coherent micro-topic a student can finish in about 15–25 minutes of focused study.
Page count is NOT fixed. 2 pages is fine. 7 pages is fine. Even 8–9 is OK if it is still ONE topic.
Do NOT aim for "exactly 5 pages".

TOPIC INTEGRITY (most important):
- Cut only when the subject meaningfully changes.
- Keep a topic together from start to finish so the student is not left mid-concept.
- If a topic spills a bit onto the next page(s), include those pages.
- If a page only begins a long new topic, start a NEW chapter there instead of gluing it to the previous one.

TITLES (critical quality rules):
- title must be a CLEAN TOPIC NAME a student would see in a table of contents.
- Good: "KDV İstisnaları", "Limit ve Süreklilik", "Osmanlı Toprak Sistemi"
- Bad / FORBIDDEN as title: full sentences, legal clauses, money amounts, thresholds, random body text.
- Especially forbidden examples: "1.500.000.000 TL'nin Üzerinde Yüklenimde bulunma zorunluluğu yoktur."
- Never copy a long sentence from the page as the title. Paraphrase into a short noun-phrase topic (3–8 words).
- subtopics = short topic labels inside the unit (not sentences). 0–5 items.
- Use the book's language.
- Cover pages ${rangeStart}–${rangeEnd} continuously with no gaps/overlaps in this batch.`

    const user = `Book: ${bookTitle}
Page range to cover: ${rangeStart}–${rangeEnd}

Page outlines:
${catalog}`

    let chapters: ChapterOut[] = []

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
          max_tokens: 1800,
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

      const parsed = safeParseJson(content) as { chapters?: ChapterOut[] }
      chapters = Array.isArray(parsed.chapters) ? parsed.chapters : []
      break
    }

    // Soft clamp into requested range + size sanity
    chapters = chapters
      .filter(
        (c) =>
          typeof c.start_page === 'number' &&
          typeof c.end_page === 'number' &&
          c.start_page <= c.end_page,
      )
      .map((c) => ({
        start_page: Math.max(rangeStart, Math.min(c.start_page, rangeEnd)),
        end_page: Math.max(rangeStart, Math.min(c.end_page, rangeEnd)),
        title: String(c.title || '').trim(),
        summary: String(c.summary || '').trim(),
        subtopics: Array.isArray(c.subtopics)
          ? c.subtopics.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
          : [],
      }))
      .filter((c) => c.end_page >= c.start_page && c.end_page - c.start_page + 1 <= 12)

    return new Response(JSON.stringify({ chapters }), {
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
