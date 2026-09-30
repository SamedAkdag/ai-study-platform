// Segment into 1–2 page micro-topics; client packs them into ~5-page units.
// Secrets: TOKENHARBOR_API_KEY (MiMo required)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmComplete, safeParseJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'

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

type MicroOut = {
  start_page: number
  end_page: number
  title: string
  summary: string
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
        return `p.${p.page} — ${heads}\n${(p.excerpt || '').slice(0, 180)}`
      })
      .join('\n\n')

    const system = `You split a textbook range into MICRO-TOPICS (alt başlıklar) for students.

Return JSON only:
{"micro_topics":[{"start_page":n,"end_page":n,"title":"short topic name","summary":"1 short sentence"}]}

SIZE (critical):
- Each micro-topic should be about 1–2 pages (rarely 3 if one concept needs it).
- Do NOT make 5–7 page blocks here. Small topical slices only.
- Cover pages ${rangeStart}–${rangeEnd} continuously with no gaps/overlaps.

TOPIC RULES:
- Cut when the sub-subject changes.
- title = clean TOC-style noun phrase (3–8 words), NOT a full sentence or money clause.
- Good: "KDV İstisnaları", "Limit Tanımı"
- Bad: long legal sentences, numbers as titles.
- Use the book's language.
- summary = one plain sentence about what this micro-topic covers.`

    const user = `Book: ${bookTitle}
Page range: ${rangeStart}–${rangeEnd}

Page outlines:
${catalog}`

    const { text } = await llmComplete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      json: false,
      temperature: 0.2,
      maxTokens: 1600,
    })

    const parsed = safeParseJson(text) as {
      micro_topics?: MicroOut[]
      chapters?: MicroOut[]
    }

    const raw = Array.isArray(parsed.micro_topics)
      ? parsed.micro_topics
      : Array.isArray(parsed.chapters)
        ? parsed.chapters
        : []

    const micro_topics = raw
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
      }))
      .filter((c) => {
        const n = c.end_page - c.start_page + 1
        return n >= 1 && n <= 3 && c.title.length >= 2
      })

    // Also return as chapters for backward-compatible clients
    return new Response(
      JSON.stringify({ micro_topics, chapters: micro_topics }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
