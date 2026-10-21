/**
 * Hybrid Toplu üret (Edge-safe):
 *   phase "warm" (default) = notes + detailed in ONE isolate
 *     → notes Cache Miss, detailed Cache Hit, worker stays under 546 limits
 *   Client then calls brief / practice / mind_map separately (should Hit).
 *
 * phase "full" = all kinds in-process (may 546 on free/small workers — avoid).
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
  taskBrief,
  taskDetailedOneShot,
  taskMindMapOneShot,
  taskNotes,
  taskPractice,
} from './cacheableChapter.ts'
import {
  buildMindMapFromPdf,
  buildOutlineMindMap,
  cleanExcerpt,
  enrichMindMapCoverage,
  extractPdfTocCandidates,
  mindMapFallback,
  parseMindMap,
  pickBetterMindMap,
  splitPageText,
  type MindMap,
  type PageSource,
} from './mindMapGen.ts'
import {
  scoreMindMap,
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
    /** warm = notes+detailed (safe); full = all 5 LLM (may 546) */
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
  const kinds: ArtifactKind[] =
    phase === 'full'
      ? ['detailed', 'brief', 'practice', 'mind_map']
      : ['detailed']

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
  }

  // ——— NOTES (cold miss expected) ———
  const notesBag = createUsageBag()
  const notesParsed = await askCacheableJson({
    fixedSource,
    task: taskNotes({ pageNums, style }),
  })
  recordUsage(notesBag, notesParsed.usage, notesParsed.provider)

  let k2 =
    typeof notesParsed.value.k2 === 'string'
      ? notesParsed.value.k2
      : typeof notesParsed.value.markdown === 'string'
        ? notesParsed.value.markdown
        : ''
  let topics = Array.isArray(notesParsed.value.topics)
    ? notesParsed.value.topics.map(String).map((t) => t.trim()).filter(Boolean)
    : []

  if (!k2.trim()) throw new Error('Empty notes from bundle')

  // Skip repair in bundle — saves a full LLM round (Edge CPU / 546 risk).
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
      explanation: k2.slice(0, 24_000),
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
    meta: { ...usageMetaBase, one_shot: true, total_chunks: 1 },
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
  let explanationDetailed = ''
  let currentPageSources = pageSources
  let currentConcepts = keyConcepts

  for (const kind of kinds) {
    const bag = createUsageBag()
    try {
      if (kind === 'detailed') {
        const filled = await askCacheableJson({
          fixedSource,
          task: taskDetailedOneShot(style),
        })
        recordUsage(bag, filled.usage, filled.provider)
        const markdown = String(
          filled.value.markdown || filled.value.k3 || '',
        ).trim()
        if (!markdown) throw new Error('Detay üretilemedi')
        explanationDetailed = markdown.slice(0, 36_000)
        await admin
          .from('chapters')
          .update({ explanation_detailed: explanationDetailed })
          .eq('id', chapterId)
      } else if (kind === 'brief') {
        const parsed = await askCacheableJson({
          fixedSource,
          task: taskBrief(style),
        })
        recordUsage(bag, parsed.usage, parsed.provider)
        const markdown = String(
          parsed.value.markdown || parsed.value.k1 || '',
        ).trim()
        if (!markdown) throw new Error('Özet üretilemedi')
        await admin
          .from('chapters')
          .update({ explanation_brief: markdown.slice(0, 12_000) })
          .eq('id', chapterId)
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
        const pdfMap = buildMindMapFromPdf(
          title,
          rawText,
          currentPageSources,
        )
        const pdfCands = extractPdfTocCandidates(rawText)
        const notesOutline = buildOutlineMindMap(
          title,
          explanationDetailed || explanation,
          currentPageSources,
        )
        const atlasPages = currentPageSources.map((s) => s.page)
        const pdfStrong =
          !!pdfMap &&
          pdfMap.branches.length >= 5 &&
          pdfMap.branches.filter((b) => (b.children?.length ?? 0) >= 2)
            .length >= 3 &&
          pdfCands.length >= 10

        let mindMap: MindMap | null = pdfMap
        if (!pdfStrong) {
          const one = await askCacheableJson({
            fixedSource,
            task: taskMindMapOneShot(),
          })
          recordUsage(bag, one.usage, one.provider)
          const fromOne = parseMindMap(one.value.mind_map ?? one.value, title)
          mindMap =
            pickBetterMindMap(pdfMap, fromOne) ||
            fromOne ||
            pdfMap ||
            notesOutline
        }
        if (!mindMap) mindMap = mindMapFallback(title, currentConcepts)
        mindMap = scrubMindMapLabels(mindMap)
        mindMap = enrichMindMapCoverage(
          mindMap,
          currentPageSources,
          atlasPages,
        )
        let quality = scoreMindMap(mindMap, atlasPages)
        if (!quality.ok && pdfMap) {
          const pdfQ = scoreMindMap(pdfMap, atlasPages)
          if (pdfQ.score >= quality.score) {
            mindMap = scrubMindMapLabels(
              enrichMindMapCoverage(pdfMap, currentPageSources, atlasPages),
            )
            quality = scoreMindMap(mindMap, atlasPages)
          }
        }
        await admin.from('chapters').update({ mind_map: mindMap }).eq('id', chapterId)
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
    phase === 'warm' ? ['brief', 'practice', 'mind_map'] : []

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
