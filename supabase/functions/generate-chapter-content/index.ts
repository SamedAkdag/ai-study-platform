// Generates K3→K2→K1 study notes ONE page-chunk per invoke (Edge CPU/mem safe).
// Client loops chunk_index until done. Practice+quiz+flashcards+mind_map on last chunk.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { llmCompleteJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'
import {
  cascadeSystemPrompt,
  practiceSystemPrompt,
} from '../_shared/pedagogy.ts'

const CHUNK_SIZE = 4
const MAX_CHUNK_CHARS = 6_500
/** Hard cap so one chapter can't spawn endless edge invokes. */
const MAX_CHUNKS = 4

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
type MindMap = {
  central: string
  branches: Array<{ label: string; children?: string[] }>
}
type FlashcardItem = {
  role: string
  label: string
  front: string
  back: string
}

const FLASH_ROLES = [
  'hook',
  'teach',
  'concept',
  'check',
  'trap',
  'summary',
] as const

const FLASH_ROLE_LABEL: Record<string, string> = {
  hook: 'Giriş',
  teach: 'Anlatım',
  concept: 'Kavram',
  check: 'Soru',
  trap: 'Tuzak',
  summary: 'Özet',
}

function normalizeRole(raw: unknown, label: unknown): string {
  const s = String(raw || label || '')
    .trim()
    .toLowerCase()
  if (FLASH_ROLES.includes(s as (typeof FLASH_ROLES)[number])) return s
  if (/giriş|hook|ısın|isin|neden/.test(s)) return 'hook'
  if (/anlat|teach|konu|explain/.test(s)) return 'teach'
  if (/kavram|tanım|tanim|ezber|concept|formül|formul/.test(s)) return 'concept'
  if (/soru|check|quiz|kontrol/.test(s)) return 'check'
  if (/tuzak|trap|yanılgı|yanilgi|dikkat/.test(s)) return 'trap'
  if (/özet|ozet|summary|pekiştir|pekistir/.test(s)) return 'summary'
  return 'teach'
}

function parseFlashcards(raw: unknown): FlashcardItem[] {
  if (!Array.isArray(raw)) return []
  const out: FlashcardItem[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as {
      role?: unknown
      label?: unknown
      front?: unknown
      back?: unknown
    }
    const front = String(r.front || '').trim().slice(0, 160)
    const back = String(r.back || '').trim().slice(0, 420)
    if (front.length < 2 || back.length < 2) continue
    const role = normalizeRole(r.role, r.label)
    const label =
      String(r.label || '').trim().slice(0, 32) ||
      FLASH_ROLE_LABEL[role] ||
      'Kart'
    out.push({ role, label, front, back })
    if (out.length >= 12) break
  }
  // Keep pedagogical order when model returns roles
  out.sort((a, b) => {
    const ia = FLASH_ROLES.indexOf(a.role as (typeof FLASH_ROLES)[number])
    const ib = FLASH_ROLES.indexOf(b.role as (typeof FLASH_ROLES)[number])
    return (ia < 0 ? 40 : ia) - (ib < 0 ? 40 : ib)
  })
  return out
}

function parseMindMap(raw: unknown, fallbackCentral: string): MindMap | null {
  if (!raw || typeof raw !== 'object') return null
  const mm = raw as { central?: unknown; branches?: unknown }
  const central =
    typeof mm.central === 'string' && mm.central.trim()
      ? mm.central.trim().slice(0, 72)
      : fallbackCentral.slice(0, 72)
  const seen = new Set<string>()
  const branches: Array<{ label: string; children?: string[] }> = []
  if (Array.isArray(mm.branches)) {
    for (const b of mm.branches) {
      if (!b || typeof b !== 'object') continue
      const row = b as { label?: unknown; children?: unknown }
      const label = String(row.label || '').trim().slice(0, 80)
      if (!label) continue
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const childSeen = new Set<string>()
      const children: string[] = []
      if (Array.isArray(row.children)) {
        for (const c of row.children) {
          const cl = String(c || '').trim().slice(0, 140)
          const ck = cl.toLowerCase()
          if (!cl || ck === key || childSeen.has(ck)) continue
          childSeen.add(ck)
          children.push(cl)
          if (children.length >= 8) break
        }
      }
      branches.push({ label, children })
      if (branches.length >= 8) break
    }
  }
  return branches.length >= 1 ? { central, branches } : null
}

function mindMapFallback(title: string, concepts: string[]): MindMap {
  const labels =
    concepts.length >= 2
      ? concepts.slice(0, 6)
      : ['Tanımlar', 'Süreç', 'Uygulama', 'Sık hatalar']
  return {
    central: title.slice(0, 72),
    branches: labels.map((label) => ({
      label: label.slice(0, 80),
      children: [],
    })),
  }
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

function packChunk(pages: Page[]): string {
  let packed = pages
    .map((p) => `=== PAGE ${p.page} ===\n${p.text}`)
    .join('\n\n')
  if (packed.length > MAX_CHUNK_CHARS) {
    packed = `${packed.slice(0, MAX_CHUNK_CHARS)}\n…[truncated]`
  }
  return packed
}

function sectionLabel(
  kind: 'brief' | 'standard' | 'detailed',
  chunkIndex: number,
  pages: number[],
): string {
  const range =
    pages.length > 0
      ? `s. ${pages[0]}–${pages[pages.length - 1]}`
      : `bölüm ${chunkIndex + 1}`
  if (kind === 'brief') return `## Özet ${chunkIndex + 1} (${range})`
  if (kind === 'detailed') return `## Detay ${chunkIndex + 1} (${range})`
  return `## Bölüm ${chunkIndex + 1} (${range})`
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
    temperature: 0.35,
    maxTokens,
    retries: 1,
    skipRepairCall: true,
  })
  return value
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
    const chunkIndex = Math.max(0, Number(body?.chunk_index) || 0)

    if (!chapterId) {
      return new Response(JSON.stringify({ error: 'chapter_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)

    if (chunkIndex === 0) {
      await admin
        .from('chapters')
        .update({
          status: 'generating',
          generation_style: style,
          explanation_brief: null,
          explanation: null,
          explanation_detailed: null,
          examples: null,
          quiz: null,
          flashcards: null,
          mind_map: null,
          key_concepts: null,
          page_sources: null,
        })
        .eq('id', chapterId)
    } else {
      await admin
        .from('chapters')
        .update({ status: 'generating', generation_style: style })
        .eq('id', chapterId)
    }

    const { data: row, error: loadErr } = await admin
      .from('chapters')
      .select(
        'page_text, explanation_brief, explanation, explanation_detailed, key_concepts, page_sources',
      )
      .eq('id', chapterId)
      .single()

    if (loadErr) throw new Error(loadErr.message)

    const rawText = row?.page_text || ''
    if (!rawText.trim()) {
      await admin.from('chapters').update({ status: 'failed' }).eq('id', chapterId)
      return new Response(
        JSON.stringify({ error: 'No page_text for chapter — cannot generate' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const allPages = splitPageText(rawText)
    const totalChunks = Math.min(
      MAX_CHUNKS,
      Math.max(1, Math.ceil(allPages.length / CHUNK_SIZE)),
    )

    if (chunkIndex >= totalChunks) {
      return new Response(
        JSON.stringify({
          ok: true,
          done: true,
          chapter_id: chapterId,
          chunk_index: chunkIndex,
          total_chunks: totalChunks,
          status: 'ready',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const start = chunkIndex * CHUNK_SIZE
    const chunkPages = allPages.slice(start, start + CHUNK_SIZE)
    // Drop other page bodies immediately (memory)
    for (let i = 0; i < allPages.length; i += 1) {
      if (i < start || i >= start + CHUNK_SIZE) allPages[i]!.text = ''
    }

    const pageNums = chunkPages.map((p) => p.page)
    const source = packChunk(chunkPages)
    for (const p of chunkPages) p.text = ''

    const parsed = await askJson(
      cascadeSystemPrompt(style),
      `Ünite: ${title}
Sayfalar: ${pageNums.join(', ')}
Parça: ${chunkIndex + 1}/${totalChunks}

SOURCE:
${source}`,
      2800,
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
          : k3.slice(0, 1600)
    const k1 =
      typeof parsed.k1 === 'string'
        ? parsed.k1
        : typeof parsed.explanation_brief === 'string'
          ? parsed.explanation_brief
          : k2.slice(0, 600)
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.map(String).slice(0, 6)
      : []

    if (!k3.trim() && !k2.trim() && !k1.trim()) {
      throw new Error(`Empty cascade for pages ${pageNums.join(', ')}`)
    }

    const briefPart = k1 || k2 || k3
    const stdPart = k2 || k3 || k1
    const detailPart = k3 || k2 || k1

    const multi = totalChunks > 1
    const briefBlock = multi
      ? `${sectionLabel('brief', chunkIndex, pageNums)}\n\n${briefPart}`
      : briefPart
    const stdBlock = multi
      ? `${sectionLabel('standard', chunkIndex, pageNums)}\n\n${stdPart}`
      : stdPart
    const detailBlock = multi
      ? `${sectionLabel('detailed', chunkIndex, pageNums)}\n\n${detailPart}`
      : detailPart

    const prevBrief = (row?.explanation_brief as string) || ''
    const prevStd = (row?.explanation as string) || ''
    const prevDetail = (row?.explanation_detailed as string) || ''

    const explanation_brief =
      chunkIndex === 0
        ? briefBlock
        : `${prevBrief}\n\n${briefBlock}`.slice(0, 12_000)
    const explanation =
      chunkIndex === 0
        ? stdBlock
        : `${prevStd}\n\n${stdBlock}`.slice(0, 24_000)
    const explanation_detailed =
      chunkIndex === 0
        ? detailBlock
        : `${prevDetail}\n\n${detailBlock}`.slice(0, 36_000)

    const prevConcepts = Array.isArray(row?.key_concepts)
      ? (row.key_concepts as string[])
      : []
    const keyConcepts = [
      ...new Set([...prevConcepts, ...topics].map((t) => t.trim()).filter(Boolean)),
    ].slice(0, 12)

    const prevSources = Array.isArray(row?.page_sources)
      ? (row.page_sources as PageSource[])
      : []
    const pageSources: PageSource[] = [
      ...prevSources.filter((p) => !pageNums.includes(p.page)),
      ...pageNums.map((page) => ({
        page,
        topics: topics.slice(0, 6),
        excerpt: '',
      })),
    ].sort((a, b) => a.page - b.page)

    const isLast = chunkIndex >= totalChunks - 1
    let examples: Example[] = []
    let quiz: QuizItem[] = []
    let flashcards: FlashcardItem[] = []
    let mindMap: MindMap | null = null

    if (isLast) {
      try {
        const practiceParsed = await askJson(
          practiceSystemPrompt(),
          `Ünite: ${title}
Stil: ${style}
Konular: ${keyConcepts.join(', ') || '(yok)'}

K1:
${explanation_brief.slice(0, 1600)}

K2:
${explanation.slice(0, 2000)}`,
          2800,
        )
        examples = Array.isArray(practiceParsed.examples)
          ? (practiceParsed.examples as Example[])
          : []
        quiz = Array.isArray(practiceParsed.quiz)
          ? (practiceParsed.quiz as QuizItem[])
          : []
        flashcards = parseFlashcards(practiceParsed.flashcards)
        mindMap = parseMindMap(practiceParsed.mind_map, title)
      } catch (err) {
        console.warn('practice generation failed, continuing', err)
      }
      if (!mindMap) mindMap = mindMapFallback(title, keyConcepts)
    }

    const { error: updateError } = await admin
      .from('chapters')
      .update({
        explanation_brief,
        explanation: explanation || explanation_brief,
        explanation_detailed:
          explanation_detailed || explanation || explanation_brief,
        key_concepts: keyConcepts.length ? keyConcepts : null,
        page_sources: pageSources,
        ...(isLast
          ? {
              examples,
              quiz,
              flashcards: flashcards.length ? flashcards : null,
              mind_map: mindMap,
              status: 'ready' as const,
            }
          : { status: 'generating' as const }),
        generation_style: style,
      })
      .eq('id', chapterId)

    if (updateError) throw new Error(updateError.message)

    return new Response(
      JSON.stringify({
        ok: true,
        done: isLast,
        chapter_id: chapterId,
        chunk_index: chunkIndex,
        next_chunk: isLast ? null : chunkIndex + 1,
        total_chunks: totalChunks,
        pages_in_chunk: pageNums.length,
        status: isLast ? 'ready' : 'generating',
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
      /* ignore */
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
