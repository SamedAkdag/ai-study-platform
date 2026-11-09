// Anlatım generation — Edge-safe multi-pass (1 LLM call per invoke).
// Client: outline → write (batch 0..n-1) → finish
// Short PDF: oneshot in a single invoke.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getMimoConfig } from '../_shared/mimo.ts'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
  resolveBookContext,
} from '../_shared/aiUsage.ts'
import {
  buildChapterFixedSource,
  CACHE_LAYOUT_VERSION,
  estimatePrefixTokens,
  fixedSourceFingerprint,
} from '../_shared/cacheableChapter.ts'
import {
  assembleNote,
  buildStagedNotes,
  extractTopicNotesMeta,
  listWeakSections,
  runNotesOutline,
  runNotesRewrite,
  runNotesWriteBatch,
  shouldStageNotes,
  type NotesPlan,
  type TopicNotesMeta,
} from '../_shared/notesPipeline.ts'
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

type NotesPass =
  | 'auto'
  | 'outline'
  | 'write'
  | 'evaluate'
  | 'rewrite'
  | 'finish'
  | 'oneshot'

function coercePlan(raw: unknown): NotesPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const sectionsIn = Array.isArray(o.sections) ? o.sections : []
  const sections = []
  for (const row of sectionsIn) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = String(r.id || '').trim()
    const title = String(r.title || '').trim()
    if (!id || !title) continue
    const minutes = Number(r.minutes)
    sections.push({
      id: id.slice(0, 12),
      title: title.slice(0, 90),
      minutes: Number.isFinite(minutes) && minutes >= 5 ? Math.round(minutes) : 10,
      goals: Array.isArray(r.goals)
        ? r.goals.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 4)
        : [],
      must: Array.isArray(r.must)
        ? r.must.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 6)
        : [],
      source_hook: String(r.source_hook || title).trim().slice(0, 160),
      tasks: Array.isArray(r.tasks)
        ? r.tasks
            .map(String)
            .map((t) => t.toLowerCase().trim())
            .filter((t) =>
              ['content', 'example', 'table', 'visual'].includes(t),
            )
            .slice(0, 3) as NotesPlan['sections'][0]['tasks']
        : (['content', 'example'] as NotesPlan['sections'][0]['tasks']),
    })
  }
  if (sections.length < 2) return null
  const transitionsIn = Array.isArray(o.transitions) ? o.transitions : []
  const transitions = []
  for (const t of transitionsIn) {
    if (!t || typeof t !== 'object') continue
    const row = t as Record<string, unknown>
    const sentence = String(row.sentence || '').trim().slice(0, 280)
    const fromSectionId = String(row.fromSectionId || '').trim()
    const toSectionId = String(row.toSectionId || '').trim()
    if (sentence && fromSectionId && toSectionId) {
      transitions.push({ fromSectionId, toSectionId, sentence })
    }
  }
  const wpm = (o.wordsPerMin && typeof o.wordsPerMin === 'object'
    ? o.wordsPerMin
    : {}) as Record<string, unknown>
  const minW = Number(wpm.min)
  const maxW = Number(wpm.max)
  const batchSize = Number(o.batchSize)
  return {
    sections,
    transitions,
    topics: Array.isArray(o.topics)
      ? o.topics.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 12)
      : sections.map((s) => s.title),
    wordsPerMin: {
      min: Number.isFinite(minW) && minW > 0 ? minW : 70,
      max: Number.isFinite(maxW) && maxW > 0 ? maxW : 100,
    },
    batchSize:
      Number.isFinite(batchSize) && batchSize >= 1 ? Math.min(3, batchSize) : 2,
  }
}

function coerceMeta(raw: unknown, pageText: string): TopicNotesMeta {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const minutes = Number(o.minutes)
    return {
      topicSource: Boolean(o.topicSource),
      minutes:
        Number.isFinite(minutes) && minutes > 0
          ? Math.min(120, minutes)
          : extractTopicNotesMeta(pageText).minutes,
      objective: String(o.objective || '').slice(0, 300),
      charter: String(o.charter || '').slice(0, 300),
      core: String(o.core || '').slice(0, 300),
      beats: String(o.beats || '').slice(0, 400),
      mustLearn: String(o.mustLearn || '').slice(0, 400),
    }
  }
  return extractTopicNotesMeta(pageText)
}

function coerceParts(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const md = String(v || '').trim()
    if (k && md) out[String(k).slice(0, 12)] = md.slice(0, 12_000)
  }
  return out
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
    let notesPass = String(body?.notes_pass || 'auto').toLowerCase() as NotesPass
    if (
      ![
        'auto',
        'outline',
        'write',
        'evaluate',
        'rewrite',
        'finish',
        'oneshot',
      ].includes(notesPass)
    ) {
      notesPass = 'auto'
    }

    if (!chapterId) {
      return new Response(JSON.stringify({ error: 'chapter_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)

    // Legacy no-op for old chunk clients (multi-pass uses notes_pass instead).
    if (chunkIndex > 0 && notesPass === 'auto' && body?.notes_pass == null) {
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

    const { data: row, error: loadErr } = await admin
      .from('chapters')
      .select('title, page_text')
      .eq('id', chapterId)
      .single()

    if (loadErr) throw new Error(loadErr.message)

    const title = String(row?.title || '').trim() || titleHint || 'Ünite'
    const rawText = String(row?.page_text || '')
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
    const topicMeta = extractTopicNotesMeta(rawText)

    // Resolve auto → outline (staged) or oneshot (short PDF)
    if (notesPass === 'auto') {
      notesPass = shouldStageNotes(rawText, topicMeta) ? 'outline' : 'oneshot'
    }

    const usageMetaBase = {
      cacheable: true,
      prefix_tokens_est: prefixTokensEst,
      prefix_fp: prefixFp,
      prefix_ok_for_th: prefixTokensEst >= 1024,
      cache_layout: CACHE_LAYOUT_VERSION,
      notes_pass: notesPass,
    }

    // ——— OUTLINE (1 LLM) ———
    if (notesPass === 'outline') {
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

      const { plan, usage, meta } = await runNotesOutline({
        fixedSource,
        pageText: rawText,
        style,
      })
      recordUsage(usageBag, usage, 'mimo')

      await logAiUsage(admin, {
        operation: 'chapter_notes',
        bookId: bookCtx.bookId,
        chapterId,
        userId: bookCtx.userId,
        bag: usageBag,
        meta: { ...usageMetaBase, stage: 'outline', sections: plan.sections.length },
      })

      const totalBatches = Math.max(
        1,
        Math.ceil(plan.sections.length / plan.batchSize),
      )

      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          chapter_id: chapterId,
          status: 'generating',
          next_pass: 'write',
          batch_index: 0,
          total_batches: totalBatches,
          plan,
          meta,
          parts: {},
          usage: {
            prompt_tokens: usageBag.usage.prompt_tokens,
            completion_tokens: usageBag.usage.completion_tokens,
            total_tokens: usageBag.usage.total_tokens,
            cached_tokens: usageBag.usage.cached_tokens,
            estimated: usageBag.usage.estimated,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— WRITE BATCH (1 LLM) ———
    if (notesPass === 'write') {
      const plan = coercePlan(body?.plan)
      if (!plan) throw new Error('notes write: plan gerekli')
      const meta = coerceMeta(body?.meta, rawText)
      const batchIndex = Math.max(0, Number(body?.batch_index) || 0)
      const priorParts = coerceParts(body?.parts)

      const written = await runNotesWriteBatch({
        fixedSource,
        style,
        plan,
        batchIndex,
        meta,
      })
      recordUsage(usageBag, written.usage, 'mimo')

      const parts = { ...priorParts, ...written.parts }
      const nextPass = written.doneWriting ? 'evaluate' : 'write'
      const nextBatch = written.doneWriting
        ? written.batchIndex
        : written.batchIndex + 1

      await logAiUsage(admin, {
        operation: 'chapter_notes',
        bookId: bookCtx.bookId,
        chapterId,
        userId: bookCtx.userId,
        bag: usageBag,
        meta: {
          ...usageMetaBase,
          stage: 'write',
          batch_index: written.batchIndex,
          total_batches: written.totalBatches,
        },
      })

      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          chapter_id: chapterId,
          status: 'generating',
          next_pass: nextPass,
          batch_index: nextBatch,
          total_batches: written.totalBatches,
          plan,
          meta,
          parts,
          usage: {
            prompt_tokens: usageBag.usage.prompt_tokens,
            completion_tokens: usageBag.usage.completion_tokens,
            total_tokens: usageBag.usage.total_tokens,
            cached_tokens: usageBag.usage.cached_tokens,
            estimated: usageBag.usage.estimated,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— EVALUATE (0 LLM) — list weak sections for rewrite ———
    if (notesPass === 'evaluate') {
      const plan = coercePlan(body?.plan)
      if (!plan) throw new Error('notes evaluate: plan gerekli')
      const parts = coerceParts(body?.parts)
      const weak = listWeakSections(plan, parts)
      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          chapter_id: chapterId,
          status: 'generating',
          next_pass: weak.length ? 'rewrite' : 'finish',
          plan,
          meta: coerceMeta(body?.meta, rawText),
          parts,
          weak,
          batch_index: Number(body?.batch_index) || 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— REWRITE (1 LLM) — one weak section ———
    if (notesPass === 'rewrite') {
      const plan = coercePlan(body?.plan)
      if (!plan) throw new Error('notes rewrite: plan gerekli')
      const meta = coerceMeta(body?.meta, rawText)
      const parts = coerceParts(body?.parts)
      const sectionId = String(body?.section_id || '').trim()
      const issues = Array.isArray(body?.issues)
        ? body.issues.map(String).slice(0, 6)
        : []
      if (!sectionId) throw new Error('notes rewrite: section_id gerekli')

      const out = await runNotesRewrite({
        fixedSource,
        style,
        plan,
        sectionId,
        priorMarkdown: parts[sectionId] || '',
        issues,
        meta,
      })
      recordUsage(usageBag, out.usage, 'mimo')
      if (out.markdown.trim().length >= 80) {
        parts[sectionId] = out.markdown.trim()
      }

      await logAiUsage(admin, {
        operation: 'chapter_notes',
        bookId: bookCtx.bookId,
        chapterId,
        userId: bookCtx.userId,
        bag: usageBag,
        meta: { ...usageMetaBase, stage: 'rewrite', section_id: sectionId },
      })

      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          chapter_id: chapterId,
          status: 'generating',
          next_pass: 'evaluate',
          plan,
          meta,
          parts,
          rewritten: sectionId,
          usage: {
            prompt_tokens: usageBag.usage.prompt_tokens,
            completion_tokens: usageBag.usage.completion_tokens,
            total_tokens: usageBag.usage.total_tokens,
            cached_tokens: usageBag.usage.cached_tokens,
            estimated: usageBag.usage.estimated,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— FINISH (0 LLM) — stitch + save ———
    if (notesPass === 'finish') {
      const plan = coercePlan(body?.plan)
      if (!plan) throw new Error('notes finish: plan gerekli')
      const parts = coerceParts(body?.parts)
      const written = new Map(Object.entries(parts))
      // Fill stubs for any missing section
      for (const s of plan.sections) {
        if (written.has(s.id)) continue
        written.set(
          s.id,
          `## ${s.title}\n\n_(Bu bölüm bu turda üretilemedi — yeniden Üret.)_`,
        )
      }
      const k2 = assembleNote(plan.sections, written, plan.transitions)
      if (!k2.trim()) throw new Error('Empty notes after assemble')

      const topics = plan.topics.length
        ? plan.topics
        : plan.sections.map((s) => s.title)
      const notesQuality = scoreNotesMarkdown(k2, pageNums)
      const keyConcepts = [
        ...new Set(topics.map((t) => t.trim()).filter(Boolean)),
      ].slice(0, 12)
      const pageSources: PageSource[] = pageNums.map((page, i) => ({
        page,
        topics:
          topics.length >= pageNums.length
            ? [topics[i % topics.length]!].filter(Boolean)
            : topics.slice(0, 6),
        excerpt: excerpts.get(page) || '',
      }))

      const { error: updateError } = await admin
        .from('chapters')
        .update({
          explanation: k2.slice(0, 36_000),
          // Detail = time budget in SOURCE; no duplicate depth columns
          explanation_detailed: null,
          key_concepts: keyConcepts.length ? keyConcepts : null,
          page_sources: pageSources,
          explanation_brief: null,
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
          ...usageMetaBase,
          stage: 'finish',
          staged: true,
          sections: plan.sections.length,
          quality: notesQuality.score,
        },
      })

      return new Response(
        JSON.stringify({
          ok: true,
          done: true,
          chapter_id: chapterId,
          status: 'ready',
          next_pass: null,
          staged: true,
          sections: plan.sections.length,
          quality: notesQuality,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— ONESHOT (short PDF, ≤2 LLM via buildStagedNotes) ———
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

    const staged = await buildStagedNotes({
      fixedSource,
      pageText: rawText,
      pageNums,
      style,
      maxLlmCalls: 2,
    })
    recordUsage(usageBag, staged.usage, 'mimo')

    const k2 = staged.k2
    if (!k2.trim()) throw new Error('Empty notes')

    const topics = staged.topics
    const notesQuality = scoreNotesMarkdown(k2, pageNums)
    const keyConcepts = [
      ...new Set(topics.map((t) => t.trim()).filter(Boolean)),
    ].slice(0, 12)
    const pageSources: PageSource[] = pageNums.map((page, i) => ({
      page,
      topics:
        topics.length >= pageNums.length
          ? [topics[i % topics.length]!].filter(Boolean)
          : topics.slice(0, 6),
      excerpt: excerpts.get(page) || '',
    }))

    const { error: updateError } = await admin
      .from('chapters')
      .update({
        explanation: k2.slice(0, 36_000),
        explanation_detailed: null,
        key_concepts: keyConcepts.length ? keyConcepts : null,
        page_sources: pageSources,
        explanation_brief: null,
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
        ...usageMetaBase,
        stage: 'oneshot',
        staged: staged.staged,
        sections: staged.sections,
        batches: staged.batches,
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        done: true,
        chapter_id: chapterId,
        status: 'ready',
        next_pass: null,
        staged: staged.staged,
        quality: notesQuality,
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
