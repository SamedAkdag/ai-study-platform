// On-demand chapter artifacts with DB cache + quality gates.
// kind: brief | detailed | practice | mind_map
// Secrets: TOKEN_HARBOR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getMimoConfig } from '../_shared/mimo.ts'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
  resolveBookContext,
  type AiUsageOperation,
  type UsageBag,
} from '../_shared/aiUsage.ts'
import {
  askCacheableJson,
  buildChapterFixedSource,
  CHAPTER_CACHE_TEMPERATURE,
  CHAPTER_CACHE_MAX_TOKENS,
  estimatePrefixTokens,
  fixedSourceFingerprint,
  taskBrief,
  taskDetailedOneShot,
  taskMindMapOneShot,
  taskPractice,
} from '../_shared/cacheableChapter.ts'
import {
  buildMindMapFromPdf,
  buildOutlineMindMap,
  enrichMindMapCoverage,
  extractPdfTocCandidates,
  mindMapFallback,
  parseMindMap,
  pickBetterMindMap,
  type MindMap,
  type PageSource,
} from '../_shared/mindMapGen.ts'
import {
  scoreMindMap,
  scorePracticeBundle,
  scrubMindMapLabels,
  validateAndCleanExamples,
  validateAndCleanQuiz,
  type QualityReport,
} from '../_shared/quality.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type ArtifactKind = 'brief' | 'detailed' | 'practice' | 'mind_map'

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
  out.sort((a, b) => {
    const ia = FLASH_ROLES.indexOf(a.role as (typeof FLASH_ROLES)[number])
    const ib = FLASH_ROLES.indexOf(b.role as (typeof FLASH_ROLES)[number])
    return (ia < 0 ? 40 : ia) - (ib < 0 ? 40 : ib)
  })
  return out
}

async function askTask(
  fixedSource: string,
  task: string,
  _maxTokens: number,
  usageBag?: UsageBag,
): Promise<Record<string, unknown>> {
  const { value, provider, usage } = await askCacheableJson({
    fixedSource,
    task,
    maxTokens: CHAPTER_CACHE_MAX_TOKENS,
    temperature: CHAPTER_CACHE_TEMPERATURE,
  })
  if (usageBag) recordUsage(usageBag, usage, provider)
  return value
}

function artifactOperation(kind: ArtifactKind): AiUsageOperation {
  if (kind === 'brief') return 'artifact_brief'
  if (kind === 'detailed') return 'artifact_detailed'
  if (kind === 'practice') return 'artifact_practice'
  return 'artifact_mind_map'
}

function hasPractice(row: {
  quiz?: unknown
  examples?: unknown
  flashcards?: unknown
}): boolean {
  const quiz = Array.isArray(row.quiz) ? row.quiz.length : 0
  const examples = Array.isArray(row.examples) ? row.examples.length : 0
  const flash = Array.isArray(row.flashcards) ? row.flashcards.length : 0
  return quiz + examples + flash > 0
}

function hasMindMap(row: { mind_map?: unknown }): boolean {
  const mm = row.mind_map as { branches?: unknown } | null
  return Array.isArray(mm?.branches) && mm!.branches!.length > 0
}

function okResponse(
  kind: ArtifactKind,
  chapterId: string,
  extra: Record<string, unknown> = {},
) {
  return new Response(
    JSON.stringify({ ok: true, kind, chapter_id: chapterId, ...extra }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const { apiKey: mimoKey } = getMimoConfig()

    if (!mimoKey) {
      throw new Error('TOKEN_HARBOR_API_KEY missing in Edge secrets')
    }
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    }

    const body = await req.json()
    const chapterId = String(body?.chapter_id || '').trim()
    const kind = String(body?.kind || '').trim() as ArtifactKind
    const force = Boolean(body?.force)
    const titleHint = String(body?.title || '').trim()

    if (!chapterId) {
      return new Response(JSON.stringify({ error: 'chapter_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!['brief', 'detailed', 'practice', 'mind_map'].includes(kind)) {
      return new Response(
        JSON.stringify({
          error: 'kind must be brief | detailed | practice | mind_map',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: row, error: loadErr } = await admin
      .from('chapters')
      .select(
        'id, title, status, page_text, explanation, explanation_brief, explanation_detailed, key_concepts, page_sources, examples, quiz, flashcards, mind_map, generation_style',
      )
      .eq('id', chapterId)
      .single()

    if (loadErr) throw new Error(loadErr.message)
    if (!row) {
      return new Response(JSON.stringify({ error: 'chapter not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Prefer DB title so FIXED_SOURCE matches notes (ignore client title drift).
    const title = String(row.title || '').trim() || titleHint || 'Ünite'
    const explanation = String(row.explanation || '').trim()
    if (!explanation) {
      return new Response(
        JSON.stringify({
          error: 'Önce standart anlatım üretilmeli (Üret)',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!force) {
      if (kind === 'brief' && String(row.explanation_brief || '').trim()) {
        return okResponse(kind, chapterId, { cached: true })
      }
      if (
        kind === 'detailed' &&
        String(row.explanation_detailed || '').trim()
      ) {
        return okResponse(kind, chapterId, { cached: true })
      }
      if (kind === 'practice' && hasPractice(row)) {
        return okResponse(kind, chapterId, { cached: true })
      }
      if (kind === 'mind_map' && hasMindMap(row)) {
        const cleaned = scrubMindMapLabels(
          parseMindMap(row.mind_map, title) ||
            (row.mind_map as MindMap),
        )
        const before = JSON.stringify(row.mind_map)
        const after = JSON.stringify(cleaned)
        if (before !== after) {
          await admin
            .from('chapters')
            .update({ mind_map: cleaned })
            .eq('id', chapterId)
        }
        return okResponse(kind, chapterId, {
          cached: true,
          normalized: true,
          quality: scoreMindMap(cleaned),
        })
      }
    }

    const keyConcepts = Array.isArray(row.key_concepts)
      ? (row.key_concepts as string[])
      : []
    const pageSources = Array.isArray(row.page_sources)
      ? (row.page_sources as PageSource[])
      : []
    const pageText = String(row.page_text || '')
    const style =
      String(row.generation_style || '').trim() ||
      'sade, sınav odaklı, örnekli'
    const atlasPages = pageSources.map((s) => s.page)

    // FIXED_SOURCE = title + page_text only (style lives in tiny GÖREV).
    const fixedSource = buildChapterFixedSource({
      title,
      pageText,
    })
    const prefixTokensEst = estimatePrefixTokens(fixedSource)
    const prefixFp = fixedSourceFingerprint(fixedSource)

    const usageBag = createUsageBag()
    const bookCtx = await resolveBookContext(admin, chapterId)
    const flushUsage = async (meta?: Record<string, unknown>) => {
      await logAiUsage(admin, {
        operation: artifactOperation(kind),
        bookId: bookCtx.bookId,
        chapterId,
        userId: bookCtx.userId,
        bag: usageBag,
        meta: {
          cacheable: true,
          prefix_tokens_est: prefixTokensEst,
          prefix_fp: prefixFp,
          prefix_ok_for_th: prefixTokensEst >= 1024,
          cache_layout: 'v4-unified-max-tokens',
          ...(meta || {}),
        },
      })
    }
    const usagePayload = () => ({
      prompt_tokens: usageBag.usage.prompt_tokens,
      completion_tokens: usageBag.usage.completion_tokens,
      total_tokens: usageBag.usage.total_tokens,
      cached_tokens: usageBag.usage.cached_tokens,
      estimated: usageBag.usage.estimated,
    })

    // ——— brief ———
    if (kind === 'brief') {
      const parsed = await askTask(
        fixedSource,
        taskBrief(style),
        900,
        usageBag,
      )
      const markdown = String(parsed.markdown || parsed.k1 || '').trim()
      if (!markdown) throw new Error('Özet üretilemedi')
      const { error } = await admin
        .from('chapters')
        .update({ explanation_brief: markdown.slice(0, 12_000) })
        .eq('id', chapterId)
      if (error) throw new Error(error.message)
      await flushUsage({ kind })
      return okResponse(kind, chapterId, {
        cached: false,
        cacheable: true,
        quality: {
          kind: 'brief',
          score: markdown.length > 200 ? 70 : 45,
          ok: true,
          issues: [],
        },
        usage: usagePayload(),
      })
    }

    // ——— detailed: one-shot on shared SOURCE (prefix cache friendly) ———
    if (kind === 'detailed') {
      const filled = await askTask(
        fixedSource,
        taskDetailedOneShot(style),
        3400,
        usageBag,
      )
      const markdown = String(filled.markdown || filled.k3 || '').trim()
      if (!markdown) throw new Error('Detay üretilemedi')
      const { error } = await admin
        .from('chapters')
        .update({ explanation_detailed: markdown.slice(0, 36_000) })
        .eq('id', chapterId)
      if (error) throw new Error(error.message)
      await flushUsage({ kind })
      return okResponse(kind, chapterId, {
        cached: false,
        cacheable: true,
        quality: {
          kind: 'detailed',
          score: markdown.length > 800 ? 75 : 50,
          ok: true,
          issues: [],
        },
        usage: usagePayload(),
      })
    }

    // ——— practice ———
    if (kind === 'practice') {
      const parsed = await askTask(
        fixedSource,
        taskPractice(style),
        3200,
        usageBag,
      )
      const { quiz, report: quizReport } = validateAndCleanQuiz(parsed.quiz)
      const { examples, report: exReport } = validateAndCleanExamples(
        parsed.examples,
      )
      const flashcards = parseFlashcards(parsed.flashcards)
      const quality = scorePracticeBundle({
        quiz,
        examples,
        flashCount: flashcards.length,
      })
      quality.issues.push(...quizReport.issues, ...exReport.issues)

      if (!quality.ok) {
        throw new Error(
          `Alıştır kalite kapısı: ${quality.issues.join(', ') || 'weak'}`,
        )
      }

      const { error } = await admin
        .from('chapters')
        .update({
          examples,
          quiz,
          flashcards: flashcards.length ? flashcards : null,
        })
        .eq('id', chapterId)
      if (error) throw new Error(error.message)
      await flushUsage({ kind })
      return okResponse(kind, chapterId, {
        cached: false,
        cacheable: true,
        quality,
        usage: usagePayload(),
      })
    }

    // ——— mind_map: PDF-first; else ONE LLM call (tiny GÖREV → max Cache Hit %) ———
    const pdfMap = buildMindMapFromPdf(title, pageText, pageSources)
    const pdfCands = extractPdfTocCandidates(pageText)
    const notesOutline = buildOutlineMindMap(
      title,
      String(row.explanation_detailed || explanation || ''),
      pageSources,
    )

    const pdfStrong =
      !!pdfMap &&
      pdfMap.branches.length >= 5 &&
      pdfMap.branches.filter((b) => (b.children?.length ?? 0) >= 2).length >=
        3 &&
      pdfCands.length >= 10

    let mindMap: MindMap | null = pdfMap
    let quality: QualityReport = scoreMindMap(pdfMap, atlasPages)

    if (!pdfStrong) {
      try {
        const one = await askTask(
          fixedSource,
          taskMindMapOneShot(),
          3200,
          usageBag,
        )
        const fromOne = parseMindMap(one.mind_map ?? one, title)
        mindMap =
          pickBetterMindMap(pdfMap, fromOne) ||
          fromOne ||
          pdfMap ||
          notesOutline
      } catch (err) {
        console.warn('mind_map one-shot failed', err)
        mindMap = pdfMap || notesOutline
      }
    }

    if (!mindMap) mindMap = mindMapFallback(title, keyConcepts)
    mindMap = scrubMindMapLabels(mindMap)
    mindMap = enrichMindMapCoverage(
      mindMap,
      pageSources,
      atlasPages.length ? atlasPages : [],
    )
    quality = scoreMindMap(mindMap, atlasPages)

    if (!quality.ok && pdfMap) {
      const pdfQ = scoreMindMap(pdfMap, atlasPages)
      if (pdfQ.score >= quality.score) {
        mindMap = scrubMindMapLabels(
          enrichMindMapCoverage(pdfMap, pageSources, atlasPages),
        )
        quality = scoreMindMap(mindMap, atlasPages)
      }
    }

    const { error } = await admin
      .from('chapters')
      .update({ mind_map: mindMap })
      .eq('id', chapterId)
    if (error) throw new Error(error.message)

    await flushUsage({ kind, pdf_strong: pdfStrong })
    return okResponse(kind, chapterId, {
      cached: false,
      cacheable: true,
      quality,
      weak: !quality.ok,
      usage: usagePayload(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
