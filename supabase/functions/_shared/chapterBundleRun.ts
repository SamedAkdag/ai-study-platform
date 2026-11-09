/**
 * Hybrid Toplu üret (Edge-safe):
 *   phase "warm" = single Anlatım (detail comes from time budget in SOURCE)
 *   Client then loads practice / mind_map on demand.
 *   phase "full" = practice + mind_map in-process (heavier).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
  resolveBookContext,
  type AiUsageOperation,
} from './aiUsage.ts'
import {
  askCacheableJson,
  buildChapterFixedSource,
  CACHE_LAYOUT_VERSION,
  estimatePrefixTokens,
  fixedSourceFingerprint,
  isTopicPageText,
  taskPractice,
} from './cacheableChapter.ts'
import { buildStagedNotes } from './notesPipeline.ts'
import {
  buildTwoStageMindMap,
  cleanExcerpt,
  enrichMindMapCoverage,
  splitPageText,
  type PageSource,
} from './mindMapGen.ts'
import {
  scoreNotesMarkdown,
  scorePracticeBundle,
  scrubMindMapLabels,
  validateAndCleanExamples,
  validateAndCleanQuiz,
} from './quality.ts'

export type ArtifactKind = 'brief' | 'detailed' | 'practice' | 'mind_map'

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
    const role = String(r.role || 'teach').toLowerCase()
    out.push({
      role: FLASH_ROLES.includes(role as (typeof FLASH_ROLES)[number])
        ? role
        : 'teach',
      label: String(r.label || role).slice(0, 32),
      front,
      back,
    })
    if (out.length >= 12) break
  }
  return out
}

function opFor(kind: ArtifactKind): AiUsageOperation {
  if (kind === 'brief') return 'artifact_brief'
  if (kind === 'detailed') return 'artifact_detailed'
  if (kind === 'practice') return 'artifact_practice'
  return 'artifact_mind_map'
}

export async function runChapterBundle(
  admin: SupabaseClient,
  input: {
    chapterId: string
    style?: string
    titleHint?: string
    forceArtifacts?: boolean
    /** warm = notes only; full = practice + mind_map extras (no fake depth copies) */
    phase?: 'warm' | 'full'
  },
): Promise<{
  ok: true
  chapter_id: string
  phase: 'warm' | 'full'
  notes_usage: Record<string, number | boolean>
  artifacts: Array<{
    kind: ArtifactKind
    ok: boolean
    cached_db?: boolean
    usage?: Record<string, number | boolean>
    error?: string
  }>
  remaining_kinds: ArtifactKind[]
  prefix_fp: string
}> {
  const chapterId = input.chapterId
  const style =
    String(input.style || '').trim() || 'sade, sınav odaklı, örnekli'
  const titleHint = String(input.titleHint || '').trim()
  const force = input.forceArtifacts !== false
  const phase = input.phase === 'full' ? 'full' : 'warm'
  // Depth chips removed: one Anlatım. Warm = notes only; client loads practice/map.
  const kinds: ArtifactKind[] =
    phase === 'full' ? ['practice', 'mind_map'] : []

  const bookCtx = await resolveBookContext(admin, chapterId)

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
    .select(
      'title, page_text, explanation, explanation_detailed, key_concepts, page_sources, mind_map',
    )
    .eq('id', chapterId)
    .single()

  if (loadErr) throw new Error(loadErr.message)

  const title = String(row?.title || '').trim() || titleHint || 'Ünite'
  const rawText = String(row?.page_text || '')
  if (!rawText.trim()) throw new Error('No page_text for chapter')

  const allPages = splitPageText(rawText)
  const pageNums = allPages.map((p) => p.page)
  const topicSource = isTopicPageText(rawText)
  const excerpts = new Map<number, string>()
  for (const p of allPages) {
    excerpts.set(p.page, cleanExcerpt(p.text, 240))
  }

  // ONE fixed source string for the entire bundle (byte-identical).
  const fixedSource = buildChapterFixedSource({ title, pageText: rawText })
  const prefixFp = fixedSourceFingerprint(fixedSource)
  const prefixTokensEst = estimatePrefixTokens(fixedSource)

  const usageMetaBase = {
    cacheable: true,
    prefix_tokens_est: prefixTokensEst,
    prefix_fp: prefixFp,
    prefix_ok_for_th: prefixTokensEst >= 1024,
    cache_layout: CACHE_LAYOUT_VERSION,
    in_process_bundle: true,
    topic_source: topicSource,
  }

  // ——— NOTES: staged for topic/long SOURCE (mind-map style pipeline) ———
  const notesBag = createUsageBag()
  // Bundle stays in one isolate — hard-cap 2 LLM calls (no client loop here).
  const staged = await buildStagedNotes({
    fixedSource,
    pageText: rawText,
    pageNums,
    style,
    maxLlmCalls: 2,
  })
  recordUsage(notesBag, staged.usage, 'mimo')

  const k2 = staged.k2
  const topics = staged.topics

  if (!k2.trim()) throw new Error('Empty notes from bundle')

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

  const { error: notesUpErr } = await admin
    .from('chapters')
    .update({
      explanation: k2.slice(0, 36_000),
      explanation_detailed: null,
      explanation_brief: null,
      key_concepts: keyConcepts.length ? keyConcepts : null,
      page_sources: pageSources,
      status: 'ready',
      generation_style: style,
    })
    .eq('id', chapterId)
  if (notesUpErr) throw new Error(notesUpErr.message)

  await logAiUsage(admin, {
    operation: 'chapter_notes',
    bookId: bookCtx.bookId,
    chapterId,
    userId: bookCtx.userId,
    bag: notesBag,
    meta: {
      ...usageMetaBase,
      staged: staged.staged,
      sections: staged.sections,
      batches: staged.batches,
      rewrites: staged.rewrites,
      minutes: staged.meta.minutes,
      total_chunks: 1,
      notes_quality: notesQuality.score,
    },
  })

  const notes_usage = {
    prompt_tokens: notesBag.usage.prompt_tokens,
    completion_tokens: notesBag.usage.completion_tokens,
    total_tokens: notesBag.usage.total_tokens,
    cached_tokens: notesBag.usage.cached_tokens,
    estimated: notesBag.usage.estimated,
  }

  // ——— ARTIFACTS in this phase (same isolate → Cache Hit after notes) ———
  const artifacts: Array<{
    kind: ArtifactKind
    ok: boolean
    cached_db?: boolean
    usage?: Record<string, number | boolean>
    error?: string
  }> = []

  let explanation = k2
  let currentPageSources = pageSources
  let currentConcepts = keyConcepts

  for (const kind of kinds) {
    const bag = createUsageBag()
    try {
      if (kind === 'brief' || kind === 'detailed') {
        // Legacy kinds — skipped; time budget owns depth
        artifacts.push({ kind, ok: true, cached_db: true })
        continue
      } else if (kind === 'practice') {
        const parsed = await askCacheableJson({
          fixedSource,
          task: taskPractice(style),
        })
        recordUsage(bag, parsed.usage, parsed.provider)
        const { quiz, report: quizReport } = validateAndCleanQuiz(
          parsed.value.quiz,
        )
        const { examples, report: exReport } = validateAndCleanExamples(
          parsed.value.examples,
        )
        const flashcards = parseFlashcards(parsed.value.flashcards)
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
        await admin
          .from('chapters')
          .update({
            examples,
            quiz,
            flashcards: flashcards.length ? flashcards : null,
          })
          .eq('id', chapterId)
      } else {
        const atlasPages = currentPageSources.map((s) => s.page)
        const { map: built, meta: mmMeta } = await buildTwoStageMindMap({
          title,
          pageText: rawText,
          pageSources: currentPageSources,
          notesMarkdown: explanation,
          concepts: currentConcepts,
          askJson: async (task) => {
            const one = await askCacheableJson({ fixedSource, task })
            recordUsage(bag, one.usage, one.provider)
            return one.value
          },
        })
        let mindMap = scrubMindMapLabels(built)
        mindMap = enrichMindMapCoverage(
          mindMap,
          currentPageSources,
          atlasPages,
        )
        await admin.from('chapters').update({ mind_map: mindMap }).eq('id', chapterId)
        await logAiUsage(admin, {
          operation: opFor(kind),
          bookId: bookCtx.bookId,
          chapterId,
          userId: bookCtx.userId,
          bag,
          meta: { ...usageMetaBase, kind, force, ...mmMeta },
        })
        artifacts.push({
          kind,
          ok: true,
          usage: {
            prompt_tokens: bag.usage.prompt_tokens,
            completion_tokens: bag.usage.completion_tokens,
            total_tokens: bag.usage.total_tokens,
            cached_tokens: bag.usage.cached_tokens,
            estimated: bag.usage.estimated,
          },
        })
        continue
      }

      await logAiUsage(admin, {
        operation: opFor(kind),
        bookId: bookCtx.bookId,
        chapterId,
        userId: bookCtx.userId,
        bag,
        meta: { ...usageMetaBase, kind, force },
      })

      artifacts.push({
        kind,
        ok: true,
        usage: {
          prompt_tokens: bag.usage.prompt_tokens,
          completion_tokens: bag.usage.completion_tokens,
          total_tokens: bag.usage.total_tokens,
          cached_tokens: bag.usage.cached_tokens,
          estimated: bag.usage.estimated,
        },
      })
    } catch (err) {
      artifacts.push({
        kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const remaining_kinds: ArtifactKind[] =
    phase === 'warm' ? ['practice', 'mind_map'] : []

  return {
    ok: true,
    chapter_id: chapterId,
    phase,
    notes_usage,
    artifacts,
    remaining_kinds,
    prefix_fp: prefixFp,
  }
}
