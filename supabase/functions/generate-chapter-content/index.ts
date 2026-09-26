// Generates 3-depth explanations + examples + quiz for ONE chapter.
// Uses stored page_text (client-extracted) — never parses PDF server-side.
// Secrets: GROQ_API_KEY (primary), GEMINI_API_KEY (fallback)
// Split into smaller JSON calls to avoid truncated/invalid JSON.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { llmComplete, safeParseJson } from '../_shared/llm.ts'

const MAX_INPUT_CHARS = 12_000

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

function splitPageText(pageText: string): Array<{ page: number; text: string }> {
  const parts = pageText.split(/---\s*Page\s+(\d+)\s*---/i)
  const pages: Array<{ page: number; text: string }> = []
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

async function askJson(
  system: string,
  user: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const { text } = await llmComplete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.3,
    maxTokens,
  })

  try {
    return safeParseJson(text) as Record<string, unknown>
  } catch (firstErr) {
    // One repair pass: model often truncates long markdown JSON
    const { text: repaired } = await llmComplete({
      messages: [
        {
          role: 'system',
          content:
            'Fix the following into VALID compact JSON only. Escape quotes in strings. Do not truncate. No markdown fences.',
        },
        {
          role: 'user',
          content: `Broken JSON:\n${text.slice(0, 10000)}\n\nReturn corrected JSON only.`,
        },
      ],
      json: true,
      temperature: 0,
      maxTokens: Math.min(maxTokens, 3000),
    })
    try {
      return safeParseJson(repaired) as Record<string, unknown>
    } catch {
      throw firstErr
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!Deno.env.get('GROQ_API_KEY') && !Deno.env.get('GEMINI_API_KEY')) {
      throw new Error('Set GROQ_API_KEY and/or GEMINI_API_KEY')
    }
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

    let packed = pages
      .map((p) => `=== PAGE ${p.page} ===\n${p.text}`)
      .join('\n\n')
    if (packed.length > MAX_INPUT_CHARS) {
      packed = `${packed.slice(0, MAX_INPUT_CHARS)}\n…[truncated]`
    }
    const pageList = pages.map((p) => p.page).join(', ')

    // --- Call 1: explanations only (smaller / safer JSON) ---
    const explainSystem = `You write study explanations for ONE textbook unit.
Return VALID JSON only (escape newlines as \\n, escape quotes):
{
  "explanation_brief": "short markdown, max ~800 chars",
  "explanation": "standard markdown, max ~3500 chars, ## headings, **key terms**",
  "explanation_detailed": "detailed markdown covering each page, max ~5000 chars, use ## Page N",
  "page_topics": [{"page":1,"topics":["label"]}]
}
Rules: cover every listed page; do not invent; match style preference; source language; keep JSON valid and complete.`

    const explainUser = `Unit: ${title}
Style: ${style}
Pages: ${pageList}

SOURCE:
${packed}`

    const explainParsed = await askJson(explainSystem, explainUser, 3500)

    const explanation_brief =
      typeof explainParsed.explanation_brief === 'string'
        ? explainParsed.explanation_brief
        : ''
    const explanation =
      typeof explainParsed.explanation === 'string'
        ? explainParsed.explanation
        : ''
    const explanation_detailed =
      typeof explainParsed.explanation_detailed === 'string'
        ? explainParsed.explanation_detailed
        : ''

    const pageTopics = Array.isArray(explainParsed.page_topics)
      ? (explainParsed.page_topics as Array<{ page: number; topics: string[] }>)
      : []
    for (const pt of pageTopics) {
      const row = pageSources.find((p) => p.page === pt.page)
      if (row && Array.isArray(pt.topics)) {
        row.topics = pt.topics.map(String).slice(0, 6)
      }
    }

    // --- Call 2: examples + quiz (compact) ---
    let examples: Example[] = []
    let quiz: QuizItem[] = []
    try {
      const practiceSystem = `Create practice material for a study unit.
Return VALID complete JSON only:
{
  "examples":[{"problem":"string","solution_steps":["step1","step2"]}],
  "quiz":[{"question":"string","options":["A","B","C","D"],"correct_index":0,"explanation":"string"}]
}
2 examples, 4 quiz questions. Source language. No invented facts outside the source.`

      const practiceUser = `Unit: ${title}
Style: ${style}
Brief context:
${explanation_brief || explanation.slice(0, 1200)}

SOURCE (excerpt):
${packed.slice(0, 6000)}`

      const practiceParsed = await askJson(practiceSystem, practiceUser, 2000)
      examples = Array.isArray(practiceParsed.examples)
        ? (practiceParsed.examples as Example[])
        : []
      quiz = Array.isArray(practiceParsed.quiz)
        ? (practiceParsed.quiz as QuizItem[])
        : []
    } catch (err) {
      console.warn('examples/quiz generation failed, continuing with explanations', err)
    }

    if (!explanation_brief && !explanation && !explanation_detailed) {
      throw new Error('Model returned empty explanations (invalid JSON)')
    }

    const { error: updateError } = await admin
      .from('chapters')
      .update({
        explanation_brief,
        explanation: explanation || explanation_brief,
        explanation_detailed: explanation_detailed || explanation || explanation_brief,
        examples,
        quiz,
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
