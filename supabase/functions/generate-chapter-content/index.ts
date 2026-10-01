// Generates 3-depth explanations via cascade K3 → K2 → K1 on 5-page chunks.
// Uses stored page_text (client-extracted) — never parses PDF server-side.
// Primary LLM: MiMo via Token Harbor (TOKEN_HARBOR_API_KEY).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { llmCompleteJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'
import {
  cascadeSystemPrompt,
  practiceSystemPrompt,
} from '../_shared/pedagogy.ts'

const CHUNK_SIZE = 5
const MAX_CHUNK_CHARS = 10_000

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
type Page = { page: number; text: string }
type ChunkCascade = {
  pages: number[]
  k3: string
  k2: string
  k1: string
  topics: string[]
}

function splitPageText(pageText: string): Page[] {
  const parts = pageText.split(/---\s*Page\s+(\d+)\s*---/i)
  const pages: Page[] = []
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

function chunkPages(pages: Page[], size: number): Page[][] {
  const chunks: Page[][] = []
  for (let i = 0; i < pages.length; i += size) {
    chunks.push(pages.slice(i, i + size))
  }
  return chunks.length ? chunks : [[]]
}

function packChunk(pages: Page[]): string {
  let packed = pages
    .map((p) => `=== PAGE ${p.page} ===\n${p.text}`)
    .join('\n\n')
  if (packed.length > MAX_CHUNK_CHARS) {
    packed = `${packed.slice(0, MAX_CHUNK_CHARS)}\n…[truncated]`
  }
  return packed
}

async function askJson(
  system: string,
  user: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const { value } = await llmCompleteJson({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
    maxTokens,
    retries: 2,
  })
  return value
}

/** Cascade per chunk in ONE call: invent K3 from source, then K2 from K3, then K1 from K2. */
async function generateChunkCascade(input: {
  title: string
  style: string
  pages: Page[]
}): Promise<ChunkCascade> {
  const pageNums = input.pages.map((p) => p.page)
  const source = packChunk(input.pages)
  const pageList = pageNums.join(', ')

  const parsed = await askJson(
    cascadeSystemPrompt(input.style),
    `Ünite: ${input.title}
Sayfalar: ${pageList}

SOURCE:
${source}`,
    4000,
  )

  const k3 =
    typeof parsed.k3 === 'string'
      ? parsed.k3
      : typeof parsed.explanation_detailed === 'string'
        ? parsed.explanation_detailed
        : ''
  const k2 =
    typeof parsed.k2 === 'string'
      ? parsed.k2
      : typeof parsed.explanation === 'string'
        ? parsed.explanation
        : k3.slice(0, 2200)
  const k1 =
    typeof parsed.k1 === 'string'
      ? parsed.k1
      : typeof parsed.explanation_brief === 'string'
        ? parsed.explanation_brief
        : k2.slice(0, 800)
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map(String).slice(0, 6)
    : []

  if (!k3.trim() && !k2.trim() && !k1.trim()) {
    throw new Error(`Empty cascade for pages ${pageList}`)
  }

  return {
    pages: pageNums,
    k3: k3 || k2 || k1,
    k2: k2 || k3 || k1,
    k1: k1 || k2 || k3,
    topics,
  }
}

function mergeCascades(chunks: ChunkCascade[]): {
  explanation_brief: string
  explanation: string
  explanation_detailed: string
} {
  if (chunks.length === 1) {
    const c = chunks[0]!
    return {
      explanation_brief: c.k1,
      explanation: c.k2,
      explanation_detailed: c.k3,
    }
  }

  const section = (label: string, body: string, pages: number[]) => {
    const range =
      pages.length > 0
        ? `s. ${pages[0]}–${pages[pages.length - 1]}`
        : 'bölüm'
    return `## ${label} (${range})\n\n${body}`
  }

  return {
    explanation_brief: chunks
      .map((c, i) => section(`Özet ${i + 1}`, c.k1, c.pages))
      .join('\n\n'),
    explanation: chunks
      .map((c, i) => section(`Bölüm ${i + 1}`, c.k2, c.pages))
      .join('\n\n'),
    explanation_detailed: chunks
      .map((c, i) => section(`Detay ${i + 1}`, c.k3, c.pages))
      .join('\n\n'),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let chapterIdForFail: string | undefined

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const { apiKey: mimoKey } = getMimoConfig()

    if (!mimoKey) {
      throw new Error(
        'TOKEN_HARBOR_API_KEY missing in Edge secrets — MiMo is required',
      )
    }
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    }

    const body = await req.json()
    const chapterId = body?.chapter_id as string | undefined
    chapterIdForFail = chapterId
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

    const chunks = chunkPages(pages, CHUNK_SIZE)
    const cascades: ChunkCascade[] = []

    for (const chunk of chunks) {
      if (!chunk.length) continue
      const cascade = await generateChunkCascade({ title, style, pages: chunk })
      cascades.push(cascade)

      // Attach topics onto page sources for this chunk
      for (const pageNum of cascade.pages) {
        const row = pageSources.find((p) => p.page === pageNum)
        if (row) row.topics = cascade.topics.slice(0, 6)
      }
    }

    if (!cascades.length) {
      throw new Error('No page chunks to generate')
    }

    const {
      explanation_brief,
      explanation,
      explanation_detailed,
    } = mergeCascades(cascades)

    // Examples + quiz from K1 overview (cheaper / stable)
    let examples: Example[] = []
    let quiz: QuizItem[] = []
    try {
      const practiceParsed = await askJson(
        practiceSystemPrompt(),
        `Ünite: ${title}
Stil: ${style}

K1 ÖZET:
${explanation_brief.slice(0, 2500)}

K2 KESİT:
${explanation.slice(0, 3500)}`,
        2000,
      )
      examples = Array.isArray(practiceParsed.examples)
        ? (practiceParsed.examples as Example[])
        : []
      quiz = Array.isArray(practiceParsed.quiz)
        ? (practiceParsed.quiz as QuizItem[])
        : []
    } catch (err) {
      console.warn('examples/quiz generation failed, continuing', err)
    }

    if (!explanation_brief && !explanation && !explanation_detailed) {
      throw new Error('Model returned empty explanations')
    }

    const { error: updateError } = await admin
      .from('chapters')
      .update({
        explanation_brief,
        explanation: explanation || explanation_brief,
        explanation_detailed:
          explanation_detailed || explanation || explanation_brief,
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
        chunks: cascades.length,
        cascade: 'K3→K2→K1',
        provider_hint: 'mimo',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (supabaseUrl && serviceKey && chapterIdForFail) {
        const admin = createClient(supabaseUrl, serviceKey)
        await admin
          .from('chapters')
          .update({ status: 'failed' })
          .eq('id', chapterIdForFail)
      }
    } catch {
      /* ignore cleanup errors */
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
