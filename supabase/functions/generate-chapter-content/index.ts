// Generates STANDARD study notes in ONE LLM call (same FIXED_SOURCE as artifacts).
// Chunking removed: SOURCE already carries the full unit text for prefix cache.
// Client may still send chunk_index; only 0 runs generation, others return done.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getMimoConfig } from '../_shared/mimo.ts'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
  type UsageBag,
  resolveBookContext,
} from '../_shared/aiUsage.ts'
import {
  askCacheableJson,
  buildChapterFixedSource,
  CHAPTER_CACHE_TEMPERATURE,
  estimatePrefixTokens,
  fixedSourceFingerprint,
  taskNotes,
} from '../_shared/cacheableChapter.ts'
import {
  cleanExcerpt,
  splitPageText,
  type PageSource,
} from '../_shared/mindMapGen.ts'
import { scoreNotesMarkdown } from '../_shared/quality.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

async function askNotes(
  fixedSource: string,
  pageNums: number[],
  style: string,
  usageBag?: UsageBag,
): Promise<Record<string, unknown>> {
  const { value, provider, usage } = await askCacheableJson({
    fixedSource,
    task: taskNotes({
      pageNums,
      chunkIndex: 0,
      totalChunks: 1,
      style,
    }),
    // Full-unit notes in one shot (was 1800×2 chunks before).
    maxTokens: 2800,
    temperature: CHAPTER_CACHE_TEMPERATURE,
  })
  if (usageBag) recordUsage(usageBag, usage, provider)
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
    const titleHint = String(body?.title || '').trim()
    const style =
      (body?.style as string)?.trim() || 'sade, sınav odaklı, örnekli'
    const chunkIndex = Math.max(0, Number(body?.chunk_index) || 0)

    if (!chapterId) {
      return new Response(JSON.stringify({ error: 'chapter_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)

    // Legacy client loop: only chunk 0 generates; later indexes no-op as done.
    if (chunkIndex > 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          done: true,
          chapter_id: chapterId,
          chunk_index: chunkIndex,
          total_chunks: 1,
          status: 'ready',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

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

    const { data: row, error: loadErr } = await admin
      .from('chapters')
      .select('title, page_text')
      .eq('id', chapterId)
      .single()

    if (loadErr) throw new Error(loadErr.message)

    const title = String(row?.title || '').trim() || titleHint || 'Ünite'
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
    const pageNums = allPages.map((p) => p.page)
    const excerpts = new Map<number, string>()
    for (const p of allPages) {
      excerpts.set(p.page, cleanExcerpt(p.text, 240))
    }

    const fixedSource = buildChapterFixedSource({
      title,
      pageText: rawText,
    })
    const prefixTokensEst = estimatePrefixTokens(fixedSource)
    const prefixFp = fixedSourceFingerprint(fixedSource)

    const usageBag = createUsageBag()
    const bookCtx = await resolveBookContext(admin, chapterId)

    const parsed = await askNotes(fixedSource, pageNums, style, usageBag)

    let k2 =
      typeof parsed.k2 === 'string'
        ? parsed.k2
        : typeof parsed.explanation === 'string'
          ? parsed.explanation
          : typeof parsed.markdown === 'string'
            ? parsed.markdown
            : ''
    let topics = Array.isArray(parsed.topics)
      ? parsed.topics
          .map(String)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12)
      : []

    if (!k2.trim()) {
      throw new Error(`Empty notes for pages ${pageNums.join(', ') || 'all'}`)
    }

    let notesQuality = scoreNotesMarkdown(k2, pageNums)
    if (!notesQuality.ok || notesQuality.score < 50) {
      try {
        const repaired = await askNotes(fixedSource, pageNums, style, usageBag)
        const rk2 =
          typeof repaired.k2 === 'string'
            ? repaired.k2
            : typeof repaired.markdown === 'string'
              ? repaired.markdown
              : ''
        if (rk2.trim().length > k2.trim().length * 0.6) {
          k2 = rk2
          if (Array.isArray(repaired.topics)) {
            topics = repaired.topics
              .map(String)
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 12)
          }
          notesQuality = scoreNotesMarkdown(k2, pageNums)
        }
      } catch (err) {
        console.warn('notes repair skipped', err)
      }
    }

    const keyConcepts = [
      ...new Set(topics.map((t) => t.trim()).filter(Boolean)),
    ].slice(0, 12)

    const pageSources: PageSource[] = pageNums.map((page, i) => {
      const topicSlice =
        topics.length >= pageNums.length
          ? [topics[i % topics.length]!].filter(Boolean)
          : topics.slice(0, 6)
      return {
        page,
        topics: topicSlice.length ? topicSlice : topics.slice(0, 6),
        excerpt: excerpts.get(page) || '',
      }
    })

    const { error: updateError } = await admin
      .from('chapters')
      .update({
        explanation: k2.slice(0, 24_000),
        key_concepts: keyConcepts.length ? keyConcepts : null,
        page_sources: pageSources,
        explanation_brief: null,
        explanation_detailed: null,
        examples: null,
        quiz: null,
        flashcards: null,
        mind_map: null,
        status: 'ready' as const,
        generation_style: style,
      })
      .eq('id', chapterId)

    if (updateError) throw new Error(updateError.message)

    await logAiUsage(admin, {
      operation: 'chapter_notes',
      bookId: bookCtx.bookId,
      chapterId,
      userId: bookCtx.userId,
      bag: usageBag,
      meta: {
        cacheable: true,
        chunk_index: 0,
        total_chunks: 1,
        pages: pageNums,
        prefix_tokens_est: prefixTokensEst,
        prefix_fp: prefixFp,
        prefix_ok_for_th: prefixTokensEst >= 1024,
        one_shot: true,
        cache_layout: 'v4-unified-max-tokens',
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        done: true,
        chapter_id: chapterId,
        chunk_index: 0,
        next_chunk: null,
        total_chunks: 1,
        pages_in_chunk: pageNums.length,
        status: 'ready',
        quality: notesQuality,
        usage: {
          prompt_tokens: usageBag.usage.prompt_tokens,
          completion_tokens: usageBag.usage.completion_tokens,
          total_tokens: usageBag.usage.total_tokens,
          cached_tokens: usageBag.usage.cached_tokens,
          estimated: usageBag.usage.estimated,
        },
        cacheable: true,
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
