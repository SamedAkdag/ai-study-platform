// Agentic topic study:
//   brief → RESEARCH (concepts/links) → CLUSTER (code) → WRITE per unit
// Secrets: REQUESTY_API_KEY (or AI_GATEWAY_* / TOKENHARBOR_*)

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
  normalizeBatchWritten,
  normalizeMinutes,
  normalizePurpose,
  normalizeResearch,
  normalizeWrittenUnit,
  planCapacity,
  researchHeader,
  researchSystemPrompt,
  researchUserPrompt,
  sanitizeText,
  writeBatchSystemPrompt,
  writeBatchUserPrompt,
  writeUnitSystemPrompt,
  writeUnitUserPrompt,
  type TopicBriefIn,
  type WrittenUnit,
} from '../_shared/topicStudyAgent.ts'

function writeMaxTokens(wordsMax: number, units: number): number {
  if (units <= 1) {
    return Math.min(2600, Math.max(1400, Math.round(wordsMax * 2.2)))
  }
  // One batched write for the path — keep under Edge + provider ceilings.
  return Math.min(3800, 700 + units * Math.round(wordsMax * 1.8))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
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
        'REQUESTY_API_KEY missing in Edge secrets — topic study requires LLM',
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
    if (goal.length < 3) {
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
      .select('id, title, status, user_id')
      .eq('id', bookId)
      .maybeSingle()

    if (bookErr || !book) {
      return new Response(JSON.stringify({ error: 'book not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const usageBag: UsageBag = createUsageBag()
    console.log('topic-study start', {
      bookId,
      model: mimoModel,
      baseURL,
      depth,
      minutes,
      purpose,
      units: capacity.unitCount,
    })

    // ——— 1) RESEARCH: concepts, links, must-learn ———
    pipelineStep = 'topic_research'
    await setProgress(admin, bookId, pipelineStep)
    const researchRes = await llmCompleteJson({
      messages: [
        { role: 'system', content: researchSystemPrompt() },
        { role: 'user', content: researchUserPrompt(brief, capacity) },
      ],
      temperature: 0.3,
      maxTokens: 1600,
      retries: 1,
      skipRepairCall: true,
    })
    recordUsage(usageBag, researchRes.usage, researchRes.provider)
    const research = normalizeResearch(researchRes.value, brief, capacity)
    console.log('topic-study research ok', {
      concepts: research.concepts.length,
      pattern: research.pattern,
    })

    // ——— 2) CLUSTER: pack concepts into time-budgeted units (no LLM) ———
    pipelineStep = 'topic_cluster'
    await setProgress(admin, bookId, pipelineStep)
    const outline = clusterResearchIntoUnits(research, brief, capacity)
    console.log('topic-study cluster ok', { units: outline.chapters.length })

    // Pause so Requesty/Novita RPM from research (+ json retries) can cool down.
    await sleep(2000)

    // ——— 3) WRITE: one LLM call (single unit or batched path) ———
    const total = outline.chapters.length
    const tokenBudget = writeMaxTokens(capacity.wordsPerUnit.max, total)
    let written: WrittenUnit[] = []

    if (total === 1) {
      pipelineStep = 'topic_write_1_of_1'
      await setProgress(admin, bookId, pipelineStep)
      const unit = outline.chapters[0]
      const writeRes = await llmCompleteJson({
        messages: [
          {
            role: 'system',
            content: writeUnitSystemPrompt(outline.pattern, brief.purpose),
          },
          {
            role: 'user',
            content: writeUnitUserPrompt({
              brief,
              outline,
              unit,
              words: capacity.wordsPerUnit,
              unitIndex: 1,
              unitTotal: 1,
            }),
          },
        ],
        temperature: 0.4,
        maxTokens: tokenBudget,
        retries: 1,
        skipRepairCall: true,
      })
      recordUsage(usageBag, writeRes.usage, writeRes.provider)
      written = [normalizeWrittenUnit(writeRes.value, unit, { soft: true })]
    } else {
      pipelineStep = 'topic_write_batch'
      await setProgress(admin, bookId, pipelineStep)
      const batchRes = await llmCompleteJson({
        messages: [
          {
            role: 'system',
            content: writeBatchSystemPrompt(outline.pattern, brief.purpose),
          },
          {
            role: 'user',
            content: writeBatchUserPrompt({
              brief,
              outline,
              words: capacity.wordsPerUnit,
            }),
          },
        ],
        temperature: 0.35,
        maxTokens: tokenBudget,
        retries: 1,
        skipRepairCall: true,
      })
      recordUsage(usageBag, batchRes.usage, batchRes.provider)
      written = normalizeBatchWritten(batchRes.value, outline)
    }
    console.log('topic-study write ok', { units: written.length })

    pipelineStep = 'topic_saving'

    if (written.length === 0) {
      throw new Error('Konu planı boş döndü — tekrar dene')
    }

    await setProgress(admin, bookId, 'topic_saving')
    await admin.from('chapters').delete().eq('book_id', bookId)

    const header = researchHeader(research)
    const rows = written.map((c, i) => {
      const n = i + 1
      const meta = [
        n === 1 ? header : '',
        `--- Topic unit ${n} ---`,
        `pattern: ${outline.pattern}`,
        `objective: ${c.objective}`,
        `minutes: ${c.minutes}`,
        `concepts: ${c.concept_ids.join(',')}`,
        '',
      ]
        .filter(Boolean)
        .join('\n')
      return {
        book_id: bookId,
        chapter_number: n,
        order_index: n,
        title: c.title,
        start_page: n,
        end_page: n,
        summary: c.summary,
        key_concepts: c.key_concepts,
        page_text: `${meta}${c.page_text}`,
        status: 'pending' as const,
      }
    })

    const { data: inserted, error: insErr } = await admin
      .from('chapters')
      .insert(rows)
      .select('id, title, order_index, status')

    if (insErr) throw insErr

    const nextTitle =
      outline.book_title && outline.book_title !== 'Konu çalışması'
        ? outline.book_title
        : book.title

    await admin
      .from('books')
      .update({
        title: nextTitle,
        subject: outline.subject || subjectHint || null,
        status: 'ready',
        progress_step: 'topic_ready',
        source_kind: 'topic',
        total_pages: written.length,
        file_url: null,
        error_message: null,
      })
      .eq('id', bookId)

    await logAiUsage(admin, {
      operation: 'topic_study',
      bag: usageBag,
      bookId,
      userId: (book.user_id as string | undefined) || null,
      meta: {
        depth,
        minutes,
        purpose,
        pattern: outline.pattern,
        units: written.length,
        concepts: research.concepts.length,
        pipeline: 'research_cluster_write',
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        book_id: bookId,
        book_title: nextTitle,
        pattern: outline.pattern,
        concepts: research.concepts.map((c) => ({
          id: c.id,
          name: c.name,
        })),
        chapters: inserted ?? [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code || '')
        : ''
    console.error('topic-study fail', { step: pipelineStep, code, msg: msg.slice(0, 500) })

    // Keep provider status/body visible for debugging (PDF vs topic).
    const statusMatch = msg.match(/AI error (\d{3}):\s*(.*)/i)
    const detail = statusMatch
      ? `provider_status=${statusMatch[1]} body=${statusMatch[2].slice(0, 280)}`
      : msg.slice(0, 360)

    if (bookIdForFail) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (supabaseUrl && serviceKey) {
          const admin = createClient(supabaseUrl, serviceKey)
          await admin
            .from('books')
            .update({
              status: 'failed',
              progress_step: `topic_failed:${pipelineStep}`,
              error_message: `[${pipelineStep}] ${msg}`.slice(0, 900),
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
        detail,
        model: mimoModel,
        code: code || undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
