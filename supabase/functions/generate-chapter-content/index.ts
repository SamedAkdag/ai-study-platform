// Generates 3-depth explanations + examples + quiz for ONE chapter.
// Uses stored page_text (client-extracted) — never parses PDF server-side.
// Covers EVERY page in the unit to reduce "missed content" fear.
// Secrets: GROQ_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'qwen/qwen3.8-27b'
const MAX_RETRIES = 4
const MAX_INPUT_CHARS = 14_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Example = { problem: string; solution_steps: string[] }
type QuizItem = {
  question: string
  options: string[]
  correct_index: number
  explanation: string
}
type PageSource = { page: number; topics: string[]; excerpt: string }

type GeneratedContent = {
  explanation_brief: string
  explanation: string
  explanation_detailed: string
  examples: Example[]
  quiz: QuizItem[]
  page_topics?: Array<{ page: number; topics: string[] }>
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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

function parseRetryMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)\s*s/i)
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500
  return 15_000
}

function splitPageText(pageText: string): Array<{ page: number; text: string }> {
  const parts = pageText.split(/---\s*Page\s+(\d+)\s*---/i)
  const pages: Array<{ page: number; text: string }> = []
  // parts: [before, num, text, num, text, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const page = Number(parts[i])
    const text = (parts[i + 1] || '').trim()
    if (Number.isFinite(page)) pages.push({ page, text })
  }
  if (pages.length === 0 && pageText.trim()) {
    pages.push({ page: 0, text: pageText.trim() })
  }
  return pages
}

async function groqJson(
  apiKey: string,
  system: string,
  user: string,
): Promise<GeneratedContent> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.35,
        reasoning_effort: 'none',
        max_tokens: 4500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })

    if (res.status === 429) {
      const body = await res.text()
      if (attempt === MAX_RETRIES) throw new Error(`Groq error 429: ${body}`)
      await sleep(parseRetryMs(body))
      continue
    }

    if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`)

    const payload = await res.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('Empty Groq response')

    const parsed = safeParseJson(content) as GeneratedContent
    return {
      explanation_brief:
        typeof parsed.explanation_brief === 'string'
          ? parsed.explanation_brief
          : '',
      explanation:
        typeof parsed.explanation === 'string' ? parsed.explanation : '',
      explanation_detailed:
        typeof parsed.explanation_detailed === 'string'
          ? parsed.explanation_detailed
          : '',
      examples: Array.isArray(parsed.examples) ? parsed.examples : [],
      quiz: Array.isArray(parsed.quiz) ? parsed.quiz : [],
      page_topics: Array.isArray(parsed.page_topics) ? parsed.page_topics : [],
    }
  }

  throw new Error('Groq retries exhausted')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('GROQ_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!apiKey) throw new Error('GROQ_API_KEY is not set')
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    }

    const body = await req.json()
    const chapterId = body?.chapter_id as string | undefined
    const title = (body?.title as string) || 'Study unit'
    const style =
      (body?.style as string)?.trim() ||
      'Clear textbook tutoring style with concrete examples'
    let pageText = (body?.page_text as string) || ''

    if (!chapterId) {
      return new Response(JSON.stringify({ error: 'chapter_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)

    await admin
      .from('chapters')
      .update({ status: 'generating', generation_style: style })
      .eq('id', chapterId)

    if (!pageText.trim()) {
      const { data: row } = await admin
        .from('chapters')
        .select('page_text, title')
        .eq('id', chapterId)
        .single()
      pageText = row?.page_text || ''
    }

    if (!pageText.trim()) {
      await admin.from('chapters').update({ status: 'failed' }).eq('id', chapterId)
      return new Response(
        JSON.stringify({ error: 'No page_text for chapter — cannot generate' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const pages = splitPageText(pageText)
    const pageSources: PageSource[] = pages.map((p) => ({
      page: p.page,
      topics: [],
      excerpt: p.text.slice(0, 1200),
    }))

    // Prefer denser per-page packing for the model, still capped
    let packed = pages
      .map((p) => `=== PAGE ${p.page} ===\n${p.text}`)
      .join('\n\n')
    if (packed.length > MAX_INPUT_CHARS) {
      packed = `${packed.slice(0, MAX_INPUT_CHARS)}\n…[truncated — still cover all listed pages conceptually]`
    }

    const pageList = pages.map((p) => p.page).join(', ')

    const system = `You are an expert tutor building study materials for ONE textbook unit.
You receive the unit page-by-page. You MUST cover every page — students fear missing content.

Return JSON only:
{
  "explanation_brief": "markdown — Hızlı özet (1–2 dk okuma): bullets + core idea only",
  "explanation": "markdown — Genel anlatım (~10–15 dk): structured ## headings, **key terms**, > callouts",
  "explanation_detailed": "markdown — Full detay: walk page-by-page or topic-by-topic, no major idea left out; include ## Page X where useful",
  "page_topics": [{"page":12,"topics":["short topic labels"]}],
  "examples": [{"problem":"...","solution_steps":["..."]}],
  "quiz": [{"question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"..."}]
}

Rules:
- Respect the student's style preference exactly.
- Do NOT invent facts not supported by the provided pages.
- If a page is thin/empty, say so briefly in detailed level for that page.
- 2–3 examples, 3–5 quiz questions.
- Use the source language of the text.
- Titles inside markdown should be clean topic names, not raw sentence fragments.`

    const user = `Unit title: ${title}
Style preference: ${style}
Pages in this unit: ${pageList}

SOURCE PAGES (cover all of them):
${packed}`

    const generated = await groqJson(apiKey, system, user)

    // Attach AI topic labels onto preserved raw excerpts (source of truth = PDF text)
    if (generated.page_topics?.length) {
      for (const pt of generated.page_topics) {
        const row = pageSources.find((p) => p.page === pt.page)
        if (row && Array.isArray(pt.topics)) {
          row.topics = pt.topics.map(String).slice(0, 6)
        }
      }
    }

    const { error: updateError } = await admin
      .from('chapters')
      .update({
        explanation_brief: generated.explanation_brief,
        explanation: generated.explanation,
        explanation_detailed: generated.explanation_detailed,
        examples: generated.examples,
        quiz: generated.quiz,
        page_sources: pageSources,
        generation_style: style,
        status: 'ready',
      })
      .eq('id', chapterId)

    if (updateError) throw new Error(updateError.message)

    return new Response(
      JSON.stringify({
        ok: true,
        chapter_id: chapterId,
        status: 'ready',
        pages_covered: pageSources.length,
      }),
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
