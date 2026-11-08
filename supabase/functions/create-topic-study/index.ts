// Topic study — client-orchestrated short stages (1 LLM / invoke):
//   research → curriculum (enqueue) → process_next×N (client drain)
// NEVER waitUntil(fetch(next)): parent isolate stays alive until child
// finishes → N units stack → Edge 546. Client calls process_next one-by-one.
// Secrets: TOKENHARBOR_API_KEY (MiMo)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getMimoConfig } from '../_shared/mimo.ts'
import { llmCompleteJson } from '../_shared/llm.ts'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
  type UsageBag,
} from '../_shared/aiUsage.ts'
import {
  clusterResearchIntoUnits,
  curriculumSystemPrompt,
  curriculumUserPrompt,
  normalizeCurriculum,
  normalizeMinutes,
  normalizePurpose,
  normalizeResearch,
  normalizeWrittenUnit,
  planCapacity,
  researchHeader,
  researchSystemPrompt,
  researchUserPrompt,
  sanitizeText,
  writeUnitSystemPrompt,
  writeUnitUserPrompt,
  type TopicBriefIn,
  type TopicOutline,
  type TopicResearch,
} from '../_shared/topicStudyAgent.ts'

/** One section write — hard Edge budget (single LLM, no retry stack). */
function writeMaxTokens(wordsMax: number, mode: string): number {
  const cap = mode === 'deep' ? 2000 : 1600
  return Math.min(cap, Math.max(1000, Math.round(wordsMax * 1.35)))
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type TopicStage =
  | 'auto'
  | 'research'
  | 'curriculum'
  | 'process_next'
  | 'write'
  | 'expand'
  | 'save'

type PipelineState = {
  brief: TopicBriefIn
  research: TopicResearch
  outline: TopicOutline
  mode: string
  wordsPerUnit: { min: number; max: number }
  next_unit: number
  total_units: number
  phase: 'writing' | 'done' | 'failed'
  subjectHint?: string
}

async function setProgress(
  admin: ReturnType<typeof createClient>,
  bookId: string,
  step: string,
) {
  await admin
    .from('books')
    .update({
      status: 'processing',
      progress_step: step,
      error_message: null,
      source_kind: 'topic',
    })
    .eq('id', bookId)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let bookIdForFail: string | undefined
  let pipelineStep = 'init'
  const { model: mimoModel, baseURL } = getMimoConfig()

  try {
    const { apiKey: mimoKey } = getMimoConfig()
    if (!mimoKey) {
      throw new Error(
        'TOKENHARBOR_API_KEY missing in Edge secrets — topic study requires LLM',
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    }

    const body = await req.json()
    const bookId = String(body?.book_id || '').trim()
    bookIdForFail = bookId || undefined
    let stage = String(body?.stage || 'auto').toLowerCase() as TopicStage
    if (
      ![
        'auto',
        'research',
        'curriculum',
        'process_next',
        'write',
        'expand',
        'save',
      ].includes(stage)
    ) {
      stage = 'auto'
    }
    if (stage === 'auto') stage = 'research'

    const goal = sanitizeText(String(body?.goal || ''), 500)
    const level = sanitizeText(String(body?.level || 'genel'), 80) || 'genel'
    const depth = body?.depth === 'path' ? 'path' : 'one'
    const minutes = normalizeMinutes(body?.minutes)
    const purpose = normalizePurpose(body?.purpose)
    const subjectHint = sanitizeText(String(body?.subject || ''), 80)

    if (!bookId) {
      return new Response(JSON.stringify({ error: 'book_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // process_next reads brief from DB — skip strict goal check
    if (stage !== 'process_next' && goal.length < 3) {
      return new Response(JSON.stringify({ error: 'goal required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const brief: TopicBriefIn = {
      goal,
      level,
      depth,
      minutes,
      purpose,
      subjectHint: subjectHint || undefined,
    }
    const capacity = planCapacity(brief)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: book, error: bookErr } = await admin
      .from('books')
      .select('id, title, status, user_id, pipeline_state')
      .eq('id', bookId)
      .maybeSingle()

    if (bookErr || !book) {
      return new Response(JSON.stringify({ error: 'book not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const usageBag: UsageBag = createUsageBag()
    console.log('topic-study stage', {
      bookId,
      stage,
      model: mimoModel,
      baseURL,
    })

    // ——— RESEARCH (1 LLM) ———
    if (stage === 'research') {
      pipelineStep = 'topic_research'
      await setProgress(admin, bookId, pipelineStep)
      const researchRes = await llmCompleteJson({
        messages: [
          { role: 'system', content: researchSystemPrompt() },
          {
            role: 'user',
            content: researchUserPrompt(brief, capacity, null),
          },
        ],
        temperature: 0.3,
        maxTokens: capacity.mode === 'deep' ? 1400 : 1200,
        retries: 0,
        skipRepairCall: true,
      })
      recordUsage(usageBag, researchRes.usage, researchRes.provider)
      const research = normalizeResearch(researchRes.value, brief, capacity)

      await logAiUsage(admin, {
        operation: 'topic_study',
        bag: usageBag,
        bookId,
        userId: (book.user_id as string | undefined) || null,
        meta: { stage: 'research', minutes, mode: capacity.mode },
      })

      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          next_stage: 'curriculum',
          research,
          mode: capacity.mode,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— CURRICULUM: plan → pending chapters (client drains process_next) ———
    if (stage === 'curriculum') {
      pipelineStep = capacity.useCurriculumLlm
        ? 'topic_curriculum'
        : 'topic_cluster'
      await setProgress(admin, bookId, pipelineStep)
      const research = body?.research as TopicResearch | undefined
      if (!research || typeof research !== 'object') {
        throw new Error('curriculum: research state gerekli')
      }
      const normalizedResearch = normalizeResearch(research, brief, capacity)

      let outline: TopicOutline
      if (capacity.useCurriculumLlm) {
        const currRes = await llmCompleteJson({
          messages: [
            { role: 'system', content: curriculumSystemPrompt() },
            {
              role: 'user',
              content: curriculumUserPrompt({
                brief,
                capacity,
                charter: null,
                research: normalizedResearch,
              }),
            },
          ],
          temperature: 0.3,
          maxTokens: capacity.mode === 'deep' ? 1500 : 1200,
          retries: 0,
          skipRepairCall: true,
        })
        recordUsage(usageBag, currRes.usage, currRes.provider)
        outline = normalizeCurriculum(
          currRes.value,
          normalizedResearch,
          brief,
          capacity,
          null,
        )
      } else {
        outline = clusterResearchIntoUnits(
          normalizedResearch,
          brief,
          capacity,
          null,
        )
      }

      // Replace chapters with pending stubs
      await admin.from('chapters').delete().eq('book_id', bookId)
      const stubRows = outline.chapters.map((c, i) => {
        const n = i + 1
        return {
          book_id: bookId,
          chapter_number: n,
          order_index: n,
          title: c.title,
          start_page: n,
          end_page: n,
          summary: c.objective || null,
          key_concepts: c.concept_ids?.length ? c.concept_ids : null,
          page_text: '',
          status: 'pending' as const,
        }
      })
      const { data: inserted, error: insErr } = await admin
        .from('chapters')
        .insert(stubRows)
        .select('id, title, order_index, status')
      if (insErr) throw insErr

      const pipeline_state: PipelineState = {
        brief,
        research: normalizedResearch,
        outline,
        mode: capacity.mode,
        wordsPerUnit: capacity.wordsPerUnit,
        next_unit: 0,
        total_units: outline.chapters.length,
        phase: 'writing',
        subjectHint: subjectHint || undefined,
      }

      const nextTitle =
        outline.book_title && outline.book_title !== 'Konu çalışması'
          ? outline.book_title
          : book.title

      await admin
        .from('books')
        .update({
          title: nextTitle,
          subject: outline.subject || subjectHint || null,
          status: 'processing',
          progress_step: 'topic_write_1_of_' + outline.chapters.length,
          source_kind: 'topic',
          total_pages: outline.chapters.length,
          pipeline_state,
          error_message: null,
        })
        .eq('id', bookId)

      await logAiUsage(admin, {
        operation: 'topic_study',
        bag: usageBag,
        bookId,
        userId: (book.user_id as string | undefined) || null,
        meta: {
          stage: 'curriculum_enqueue',
          units: outline.chapters.length,
          client_drain: true,
        },
      })

      // Client must call process_next — do NOT waitUntil(fetch) here
      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          queued: true,
          poll: true,
          book_id: bookId,
          book_title: nextTitle,
          units: outline.chapters.length,
          chapters: inserted ?? [],
          mode: capacity.mode,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ——— PROCESS_NEXT: exactly 1 unit write, then return (client drains) ———
    if (stage === 'process_next') {
      const rawState = book.pipeline_state as PipelineState | null
      if (!rawState || rawState.phase === 'done') {
        return new Response(
          JSON.stringify({
            ok: true,
            done: true,
            book_id: bookId,
            skipped: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      if (rawState.phase === 'failed') {
        return new Response(
          JSON.stringify({ ok: false, done: true, error: 'pipeline failed' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const stateBrief = rawState.brief
      const stateCapacity = planCapacity(stateBrief)
      const outline = rawState.outline
      const research = rawState.research
      const unitIndex = Math.max(0, Number(rawState.next_unit) || 0)
      const total = outline.chapters.length
      const unit = outline.chapters[unitIndex]

      if (!unit) {
        // Nothing left — finalize
        await admin
          .from('books')
          .update({
            status: 'ready',
            progress_step: 'topic_ready',
            pipeline_state: { ...rawState, phase: 'done', next_unit: total },
            error_message: null,
          })
          .eq('id', bookId)
        return new Response(
          JSON.stringify({ ok: true, done: true, book_id: bookId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      pipelineStep = `topic_write_${unitIndex + 1}_of_${total}`
      await setProgress(admin, bookId, pipelineStep)

      const words = rawState.wordsPerUnit || stateCapacity.wordsPerUnit
      const mode = (rawState.mode || stateCapacity.mode) as
        | 'lite'
        | 'standard'
        | 'deep'
      const tokenBudget = writeMaxTokens(words.max, mode)

      const writeRes = await llmCompleteJson({
        messages: [
          {
            role: 'system',
            content: writeUnitSystemPrompt(
              outline.pattern,
              stateBrief.purpose,
              mode,
            ),
          },
          {
            role: 'user',
            content: writeUnitUserPrompt({
              brief: stateBrief,
              outline,
              unit,
              words,
              unitIndex: unitIndex + 1,
              unitTotal: total,
              mode,
            }),
          },
        ],
        temperature: 0.35,
        maxTokens: tokenBudget,
        retries: 0,
        skipRepairCall: true,
      })
      recordUsage(usageBag, writeRes.usage, writeRes.provider)

      const minChars = Math.max(400, Math.round(words.min * 3.2))
      const unitWritten = normalizeWrittenUnit(writeRes.value, unit, {
        soft: true,
        minChars,
      })

      const header =
        unitIndex === 0 ? researchHeader(research, outline.charter) : ''
      const meta = [
        header,
        `--- Topic unit ${unitIndex + 1} ---`,
        `pattern: ${outline.pattern}`,
        `mode: ${mode}`,
        `objective: ${unitWritten.objective}`,
        `minutes: ${unitWritten.minutes}`,
        `concepts: ${unitWritten.concept_ids.join(',')}`,
        unit.timed_beats?.length
          ? `beats: ${unit.timed_beats.map((b) => `${b.minutes}m ${b.focus}`).join(' | ')}`
          : '',
        '',
      ]
        .filter(Boolean)
        .join('\n')

      const { data: chRow } = await admin
        .from('chapters')
        .select('id')
        .eq('book_id', bookId)
        .eq('order_index', unitIndex + 1)
        .maybeSingle()

      if (chRow?.id) {
        await admin
          .from('chapters')
          .update({
            title: unitWritten.title,
            summary: unitWritten.summary,
            key_concepts: unitWritten.key_concepts,
            page_text: `${meta}${unitWritten.page_text}`,
            status: 'pending',
          })
          .eq('id', chRow.id)
      }

      const nextUnit = unitIndex + 1
      const finished = nextUnit >= total

      await logAiUsage(admin, {
        operation: 'topic_study',
        bag: usageBag,
        bookId,
        userId: (book.user_id as string | undefined) || null,
        meta: {
          stage: 'process_next',
          unit_index: unitIndex,
          remaining: Math.max(0, total - nextUnit),
        },
      })

      if (finished) {
        const nextTitle =
          outline.book_title && outline.book_title !== 'Konu çalışması'
            ? outline.book_title
            : book.title
        await admin
          .from('books')
          .update({
            title: nextTitle,
            status: 'ready',
            progress_step: 'topic_ready',
            source_kind: 'topic',
            total_pages: total,
            pipeline_state: {
              ...rawState,
              next_unit: nextUnit,
              phase: 'done',
            },
            error_message: null,
          })
          .eq('id', bookId)

        const { data: chapters } = await admin
          .from('chapters')
          .select('id, title, order_index, status')
          .eq('book_id', bookId)
          .order('order_index')

        return new Response(
          JSON.stringify({
            ok: true,
            done: true,
            book_id: bookId,
            book_title: nextTitle,
            chapters: chapters ?? [],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      await admin
        .from('books')
        .update({
          pipeline_state: {
            ...rawState,
            next_unit: nextUnit,
            phase: 'writing',
          },
          progress_step: `topic_write_${nextUnit + 1}_of_${total}`,
        })
        .eq('id', bookId)

      return new Response(
        JSON.stringify({
          ok: true,
          done: false,
          unit_index: unitIndex,
          remaining: total - nextUnit,
          book_id: bookId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (stage === 'write' || stage === 'expand' || stage === 'save') {
      return new Response(
        JSON.stringify({
          error:
            'Bu aşama kaldırıldı — curriculum sonrası client process_next drain kullanın.',
          step: stage,
        }),
        {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    throw new Error(`Bilinmeyen stage: ${stage}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('topic-study fail', {
      step: pipelineStep,
      msg: msg.slice(0, 500),
    })

    if (bookIdForFail) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (supabaseUrl && serviceKey) {
          const admin = createClient(supabaseUrl, serviceKey)
          const { data: prev } = await admin
            .from('books')
            .select('pipeline_state')
            .eq('id', bookIdForFail)
            .maybeSingle()
          const ps = (prev?.pipeline_state || {}) as Record<string, unknown>
          await admin
            .from('books')
            .update({
              status: 'failed',
              progress_step: `topic_failed:${pipelineStep}`,
              error_message: `[${pipelineStep}] ${msg}`.slice(0, 900),
              pipeline_state: { ...ps, phase: 'failed' },
            })
            .eq('id', bookIdForFail)
        }
      } catch {
        /* ignore */
      }
    }
    return new Response(
      JSON.stringify({
        error: msg,
        step: pipelineStep,
        model: mimoModel,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
