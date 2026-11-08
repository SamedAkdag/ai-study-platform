/**
 * Multi-stage Anlatım with Edge-safe call budgets.
 *
 * Preferred: client orchestrates outline → write batches → finish
 * (1 LLM call per Edge invoke → no 546).
 *
 * Fallback in one invoke: max 2 LLM calls (outline + single write).
 */

import {
  buildCacheableMessages,
  CHAPTER_CACHE_MAX_TOKENS,
  isTopicPageText,
  taskNotes,
  taskNotesBatch,
  taskNotesOutline,
  taskNotesRewrite,
} from './cacheableChapter.ts'
import type { LlmResult, TokenUsage } from './llm.ts'
import { emptyUsage, addTokenUsage, llmComplete, safeParseJson } from './llm.ts'

/**
 * Notes JSON: exactly 1 LLM per invoke. Salvage truncated JSON locally —
 * never a 2nd llmComplete (that is what triggers Edge 546).
 */
async function askNotesJson(opts: {
  fixedSource: string
  task: string
}): Promise<{
  value: Record<string, unknown>
  provider: LlmResult['provider']
  usage: TokenUsage
}> {
  const raw = await llmComplete({
    messages: buildCacheableMessages(opts.fixedSource, opts.task),
    json: true,
    temperature: 0.15,
    maxTokens: CHAPTER_CACHE_MAX_TOKENS,
  })
  try {
    const value = safeParseJson(raw.text) as Record<string, unknown>
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { value, provider: raw.provider, usage: raw.usage }
    }
  } catch {
    /* salvage */
  }
  const salvaged = salvageNotesJson(raw.text)
  if (salvaged) {
    console.warn('notes JSON salvaged (no 2nd LLM)')
    return { value: salvaged, provider: raw.provider, usage: raw.usage }
  }
  throw new Error('AI response was not valid JSON')
}

/** Pull partial NOTES_BATCH / REWRITE from truncated model output. */
export function salvageNotesJson(raw: string): Record<string, unknown> | null {
  const text = String(raw || '')
  if (!text.trim()) return null

  // parts: [{id, markdown}] — recover each markdown blob even if JSON broke
  const parts: Array<{ id: string; markdown: string }> = []
  const partRe =
    /"id"\s*:\s*"(s\d+)"\s*,\s*"markdown"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let m: RegExpExecArray | null
  while ((m = partRe.exec(text)) !== null) {
    const id = m[1]!
    const md = m[2]!
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
    if (md.trim().length >= 40) parts.push({ id, markdown: md.trim() })
  }
  if (parts.length) return { parts }

  // Single rewrite shape
  const one = text.match(
    /"markdown"\s*:\s*"((?:\\.|[^"\\])*)"/,
  )
  if (one?.[1] && one[1].trim().length >= 40) {
    const md = one[1]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
    return { markdown: md.trim() }
  }

  // Bare ## markdown dumped outside JSON
  if (/^##\s+/m.test(text) && text.trim().length >= 120) {
    const start = text.indexOf('##')
    return { markdown: text.slice(start).replace(/```$/g, '').trim() }
  }

  return null
}

export type NotesTask = 'content' | 'example' | 'table' | 'visual'

export type NotesSectionPlan = {
  id: string
  title: string
  minutes: number
  goals: string[]
  must: string[]
  source_hook: string
  tasks: NotesTask[]
}

export type NotesTransition = {
  fromSectionId: string
  toSectionId: string
  sentence: string
}

export type NotesPlan = {
  sections: NotesSectionPlan[]
  transitions: NotesTransition[]
  topics: string[]
  wordsPerMin: { min: number; max: number }
  batchSize: number
}

export type TopicNotesMeta = {
  topicSource: boolean
  minutes: number
  objective: string
  charter: string
  core: string
  beats: string
  mustLearn: string
}

export type StagedNotesResult = {
  k2: string
  topics: string[]
  staged: boolean
  sections: number
  batches: number
  rewrites: number
  usage: TokenUsage
  meta: TopicNotesMeta
}

const TASKS: NotesTask[] = ['content', 'example', 'table', 'visual']

/** Hard cap for a single Edge isolate (wall clock / 546). */
export const NOTES_EDGE_MAX_LLM = 2

export function extractTopicNotesMeta(pageText: string): TopicNotesMeta {
  const text = String(pageText || '')
  const topicSource = isTopicPageText(text)
  const pick = (re: RegExp) => {
    const m = text.match(re)
    return m?.[1]?.trim() || ''
  }
  const minutesRaw = Number(pick(/^\s*minutes:\s*(\d+)/im))
  return {
    topicSource,
    minutes:
      Number.isFinite(minutesRaw) && minutesRaw > 0
        ? Math.min(120, minutesRaw)
        : topicSource
          ? 60
          : 30,
    objective: pick(/^\s*objective:\s*(.+)$/im),
    charter: pick(/^\s*charter:\s*(.+)$/im),
    core: pick(/^\s*core:\s*(.+)$/im),
    beats: pick(/^\s*beats:\s*(.+)$/im),
    mustLearn: pick(/^\s*must_learn:\s*(.+)$/im),
  }
}

export function shouldStageNotes(
  pageText: string,
  meta?: TopicNotesMeta,
): boolean {
  const m = meta ?? extractTopicNotesMeta(pageText)
  if (m.topicSource) return true
  if (String(pageText || '').trim().length >= 3500) return true
  return false
}

/**
 * Quality-first capacity. Client does many Edge invokes (1 LLM each),
 * so we do NOT thin content for wall-clock — we add round-trips instead.
 * batchSize=1 → one full section per invoke (max depth in max_tokens).
 */
function sectionTarget(meta: TopicNotesMeta): {
  count: number
  batchSize: number
  wordsPerMin: { min: number; max: number }
} {
  // Dense lesson, but capped so one section fits CHAPTER_CACHE_MAX_TOKENS
  // as valid JSON (truncation → "bozuk yanıt"). More sections keep total depth.
  const wordsPerMin = { min: 100, max: 130 }
  if (meta.minutes >= 80) {
    return { count: 8, batchSize: 1, wordsPerMin }
  }
  if (meta.minutes >= 45) {
    return { count: 6, batchSize: 1, wordsPerMin }
  }
  if (meta.minutes >= 25) {
    return { count: 5, batchSize: 1, wordsPerMin }
  }
  return { count: 4, batchSize: 1, wordsPerMin }
}

/** Hard ceiling per section markdown (~fits 4.2k completion tokens as JSON). */
export const NOTES_SECTION_WORD_CAP = 950

function sanitizeTitle(raw: string, fallback: string): string {
  const t = String(raw || '')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
  return t || fallback
}

function parseTasks(raw: unknown): NotesTask[] {
  const list = Array.isArray(raw) ? raw : []
  const out: NotesTask[] = []
  for (const x of list) {
    const t = String(x || '').toLowerCase().trim()
    if ((TASKS as string[]).includes(t) && !out.includes(t as NotesTask)) {
      out.push(t as NotesTask)
    }
  }
  if (!out.includes('content')) out.unshift('content')
  return out.slice(0, 4)
}

function allocateMinutes(count: number, total: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [total]
  const intro =
    total >= 40
      ? Math.min(12, Math.max(8, Math.round(total * 0.12)))
      : Math.max(5, Math.round(total / count))
  const outro = total >= 40 ? intro : Math.max(5, Math.round(total / count))
  const midCount = Math.max(1, count - 2)
  const midBudget = Math.max(midCount * 5, total - intro - outro)
  const midEach = Math.floor(midBudget / midCount)
  const mins = [
    intro,
    ...Array.from({ length: midCount }, () => midEach),
    outro,
  ]
  let drift = total - mins.reduce((a, b) => a + b, 0)
  let i = 1
  while (drift !== 0 && midCount > 0) {
    const idx = 1 + (i % midCount)
    mins[idx] = (mins[idx] || midEach) + (drift > 0 ? 1 : -1)
    drift += drift > 0 ? -1 : 1
    i += 1
    if (i > 200) break
  }
  return mins.map((m) => Math.max(5, m)).slice(0, count)
}

function normalizeSectionMinutes(
  sections: NotesSectionPlan[],
  totalMinutes: number,
): NotesSectionPlan[] {
  const allocated = allocateMinutes(sections.length, totalMinutes)
  const withMins = sections.map((s, i) => ({
    ...s,
    minutes:
      Number.isFinite(s.minutes) && s.minutes >= 5
        ? s.minutes
        : allocated[i] || 10,
  }))
  if (withMins.length === 0) return withMins
  const head = withMins.slice(0, -1).reduce((a, b) => a + b.minutes, 0)
  const last = withMins[withMins.length - 1]!
  withMins[withMins.length - 1] = {
    ...last,
    minutes: Math.max(5, totalMinutes - head),
  }
  return withMins
}

function defaultTasksForIndex(i: number, n: number): NotesTask[] {
  if (i === 0) return ['content', 'example', 'visual']
  if (i === n - 1) return ['content', 'table', 'example']
  if (i % 3 === 1) return ['content', 'example', 'table']
  if (i % 3 === 2) return ['content', 'example', 'visual']
  return ['content', 'example', 'table', 'visual']
}

function deterministicOutline(
  pageText: string,
  meta: TopicNotesMeta,
  count: number,
): NotesSectionPlan[] {
  const minutes = allocateMinutes(count, meta.minutes)
  const headings = [...String(pageText || '').matchAll(/^##\s+(.+)$/gm)]
    .map((m) => sanitizeTitle(m[1] || '', ''))
    .filter(Boolean)
    .slice(0, count)

  const seeds =
    headings.length >= Math.min(3, count)
      ? headings
      : [
          meta.objective,
          meta.core,
          meta.charter,
          ...meta.mustLearn.split(/[·|•]/).map((x) => x.trim()),
          ...meta.beats.split('|').map((x) => x.trim()),
        ]
          .map((x) => sanitizeTitle(x, ''))
          .filter((x) => x.length >= 8)
          .slice(0, count)

  const titles =
    seeds.length >= 2
      ? seeds
      : [
          'Giriş ve bağlam',
          'Temel tanımlar',
          'İşleyen mantık',
          'Çalışılmış örnek',
          'Özet ve değerlendirme',
        ].slice(0, count)

  if (titles.length >= 2) {
    if (!/giriş|bağlam|hedef/i.test(titles[0]!)) {
      titles[0] = `Giriş: ${titles[0]}`
    }
    const last = titles.length - 1
    if (!/özet|değerlendirme|kontrol|sınav/i.test(titles[last]!)) {
      titles[last] = 'Özet ve değerlendirme'
    }
  }

  return titles.map((title, i) => ({
    id: `s${i + 1}`,
    title,
    minutes: minutes[i] || 10,
    goals: [meta.objective || title].filter(Boolean).slice(0, 2),
    must: [],
    source_hook: title,
    tasks: defaultTasksForIndex(i, titles.length),
  }))
}

function parseOutline(
  raw: Record<string, unknown>,
  fallback: NotesSectionPlan[],
  count: number,
  totalMinutes: number,
): {
  sections: NotesSectionPlan[]
  topics: string[]
  transitions: NotesTransition[]
} {
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : []
  const sections: NotesSectionPlan[] = []
  for (let i = 0; i < sectionsRaw.length && sections.length < count + 2; i++) {
    const row = sectionsRaw[i]
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const title = sanitizeTitle(String(r.title || ''), '')
    if (!title) continue
    const must = Array.isArray(r.must)
      ? r.must.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
      : []
    const goals = Array.isArray(r.goals)
      ? r.goals.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
      : must.slice(0, 2)
    const minutes = Number(r.minutes)
    sections.push({
      id: String(r.id || `s${sections.length + 1}`).slice(0, 12),
      title,
      minutes: Number.isFinite(minutes) && minutes >= 5 ? Math.round(minutes) : 0,
      goals: goals.length ? goals : [title],
      must,
      source_hook: String(r.source_hook || r.hook || title).trim().slice(0, 160),
      tasks: parseTasks(r.tasks || r.assignedTasks),
    })
  }

  const topics = Array.isArray(raw.topics)
    ? raw.topics.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 12)
    : sections.map((s) => s.title).slice(0, 12)

  const transitionsRaw = Array.isArray(raw.transitions) ? raw.transitions : []
  const transitions: NotesTransition[] = []
  for (const t of transitionsRaw) {
    if (!t || typeof t !== 'object') continue
    const row = t as Record<string, unknown>
    const sentence = String(row.sentence || '').trim().slice(0, 280)
    const fromSectionId = String(row.fromSectionId || row.from || '').trim()
    const toSectionId = String(row.toSectionId || row.to || '').trim()
    if (sentence && fromSectionId && toSectionId) {
      transitions.push({ fromSectionId, toSectionId, sentence })
    }
  }

  const base = sections.length >= 3 ? sections.slice(0, count) : fallback
  return {
    sections: normalizeSectionMinutes(base, totalMinutes),
    topics: topics.length ? topics : base.map((s) => s.title),
    transitions,
  }
}

function parseBatchParts(
  raw: Record<string, unknown>,
  expected: NotesSectionPlan[],
): Map<string, string> {
  const out = new Map<string, string>()
  const parts = Array.isArray(raw.parts) ? raw.parts : []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    const id = String(p.id || '').trim()
    let md = String(p.markdown || p.k2 || p.text || '').trim()
    if (!md) continue
    if (!/^##\s+/m.test(md)) {
      const match = expected.find((s) => s.id === id)
      md = `## ${match?.title || id}\n\n${md}`
    }
    if (id) out.set(id, md)
  }
  if (out.size === 0 && typeof raw.markdown === 'string') {
    out.set(expected[0]?.id || 's1', String(raw.markdown).trim())
  }
  return out
}

export function chunkSections<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function defaultTransitions(sections: NotesSectionPlan[]): NotesTransition[] {
  const out: NotesTransition[] = []
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i]!
    const b = sections[i + 1]!
    out.push({
      fromSectionId: a.id,
      toSectionId: b.id,
      sentence: `Şimdi “${a.title}”den “${b.title}”e geçiyoruz — önceki kazanımı kullanacağız.`,
    })
  }
  return out
}

export function assembleNote(
  sections: NotesSectionPlan[],
  written: Map<string, string> | Record<string, string>,
  transitions: NotesTransition[],
): string {
  const map =
    written instanceof Map
      ? written
      : new Map(Object.entries(written || {}))
  const byPair = new Map(
    transitions.map((t) => [`${t.fromSectionId}->${t.toSectionId}`, t.sentence]),
  )
  const parts: string[] = []
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!
    const body = map.get(s.id) || `## ${s.title}\n\n_(eksik)_`
    parts.push(body.trim())
    if (i < sections.length - 1) {
      const next = sections[i + 1]!
      const sentence =
        byPair.get(`${s.id}->${next.id}`) ||
        `Şimdi “${next.title}” bölümüne geçiyoruz.`
      parts.push(`\n> **Geçiş:** ${sentence}\n`)
    }
  }
  return parts.join('\n\n').trim()
}

function fillMissingStubs(
  sections: NotesSectionPlan[],
  written: Map<string, string>,
) {
  for (const s of sections) {
    if (written.has(s.id)) continue
    const must =
      s.must.length > 0
        ? s.must.map((m) => `- ${m}`).join('\n')
        : `- ${s.source_hook || s.title}`
    written.set(
      s.id,
      `## ${s.title}\n\nSOURCE’taki şu noktaları işle:\n${must}\n\n(Bu bölüm kısmi — yeniden üretilebilir.)`,
    )
  }
}

export async function runNotesOutline(opts: {
  fixedSource: string
  pageText: string
  style: string
}): Promise<{ plan: NotesPlan; usage: TokenUsage; meta: TopicNotesMeta }> {
  const meta = extractTopicNotesMeta(opts.pageText)
  const target = sectionTarget(meta)
  const fallback = deterministicOutline(opts.pageText, meta, target.count)
  const outlineRes = await askNotesJson({
    fixedSource: opts.fixedSource,
    task: taskNotesOutline({
      style: opts.style,
      sectionCount: target.count,
      totalMinutes: meta.minutes,
      meta,
    }),
  })
  const parsed = parseOutline(
    outlineRes.value,
    fallback,
    target.count,
    meta.minutes,
  )
  const transitions =
    parsed.transitions.length >= Math.max(1, parsed.sections.length - 1)
      ? parsed.transitions
      : defaultTransitions(parsed.sections)

  return {
    plan: {
      sections: parsed.sections,
      transitions,
      topics: parsed.topics,
      wordsPerMin: target.wordsPerMin,
      batchSize: target.batchSize,
    },
    usage: outlineRes.usage,
    meta,
  }
}

export async function runNotesWriteBatch(opts: {
  fixedSource: string
  style: string
  plan: NotesPlan
  batchIndex: number
  meta: TopicNotesMeta
}): Promise<{
  parts: Record<string, string>
  usage: TokenUsage
  batchIndex: number
  totalBatches: number
  doneWriting: boolean
}> {
  const batches = chunkSections(opts.plan.sections, opts.plan.batchSize)
  const totalBatches = Math.max(1, batches.length)
  const idx = Math.max(0, Math.min(opts.batchIndex, totalBatches - 1))
  const batch = batches[idx] || opts.plan.sections
  const filled = await askNotesJson({
    fixedSource: opts.fixedSource,
    task: taskNotesBatch({
      style: opts.style,
      wordsPerMin: opts.plan.wordsPerMin,
      sections: batch,
      meta: opts.meta,
    }),
  })
  const map = parseBatchParts(filled.value, batch)
  const parts: Record<string, string> = {}
  for (const [k, v] of map) parts[k] = v
  return {
    parts,
    usage: filled.usage,
    batchIndex: idx,
    totalBatches,
    doneWriting: idx >= totalBatches - 1,
  }
}

export async function runNotesRewrite(opts: {
  fixedSource: string
  style: string
  plan: NotesPlan
  sectionId: string
  priorMarkdown: string
  issues: string[]
  meta: TopicNotesMeta
}): Promise<{ markdown: string; usage: TokenUsage; sectionId: string }> {
  const section = opts.plan.sections.find((s) => s.id === opts.sectionId)
  if (!section) throw new Error(`rewrite: section ${opts.sectionId} yok`)
  const rewritten = await askNotesJson({
    fixedSource: opts.fixedSource,
    task: taskNotesRewrite({
      style: opts.style,
      section,
      wordsPerMin: opts.plan.wordsPerMin,
      issues: opts.issues,
      priorMarkdown: opts.priorMarkdown,
      meta: opts.meta,
    }),
  })
  let md = String(
    rewritten.value.markdown ||
      rewritten.value.k2 ||
      '',
  ).trim()
  if (!md && Array.isArray(rewritten.value.parts)) {
    const p0 = rewritten.value.parts[0]
    if (p0 && typeof p0 === 'object') {
      md = String((p0 as { markdown?: string }).markdown || '').trim()
    }
  }
  if (md && !/^##\s+/m.test(md)) md = `## ${section.title}\n\n${md}`
  return {
    markdown: md,
    usage: rewritten.usage,
    sectionId: section.id,
  }
}

/** Score all sections; return those below 70 for client rewrite passes. */
export function listWeakSections(
  plan: NotesPlan,
  parts: Record<string, string>,
): Array<{ sectionId: string; score: number; issues: string[] }> {
  const weak: Array<{ sectionId: string; score: number; issues: string[] }> = []
  for (const s of plan.sections) {
    const md = parts[s.id] || ''
    const ev = scoreSectionMarkdown(md, s, plan.wordsPerMin)
    if (ev.requiresReplan) {
      weak.push({
        sectionId: s.id,
        score: ev.score,
        issues: ev.issues,
      })
    }
  }
  // Worst first
  weak.sort((a, b) => a.score - b.score)
  return weak
}

/**
 * Single-invoke path for bundle / short path: ≤2 LLM calls.
 * Prefer client multi-pass for topic Anlatım.
 */
export async function buildStagedNotes(opts: {
  fixedSource: string
  pageText: string
  pageNums: number[]
  style: string
  /** Default NOTES_EDGE_MAX_LLM (2). */
  maxLlmCalls?: number
}): Promise<StagedNotesResult> {
  const meta = extractTopicNotesMeta(opts.pageText)
  const usage = emptyUsage()
  const maxCalls = Math.max(1, opts.maxLlmCalls ?? NOTES_EDGE_MAX_LLM)

  if (!shouldStageNotes(opts.pageText, meta)) {
    const one = await askNotesJson({
      fixedSource: opts.fixedSource,
      task: taskNotes({
        pageNums: opts.pageNums,
        style: opts.style,
        topicSource: meta.topicSource,
      }),
    })
    Object.assign(usage, addTokenUsage(usage, one.usage))
    const k2 =
      typeof one.value.k2 === 'string'
        ? one.value.k2
        : typeof one.value.markdown === 'string'
          ? one.value.markdown
          : ''
    const topics = Array.isArray(one.value.topics)
      ? one.value.topics.map(String).map((t) => t.trim()).filter(Boolean)
      : []
    return {
      k2,
      topics,
      staged: false,
      sections: 0,
      batches: 0,
      rewrites: 0,
      usage,
      meta,
    }
  }

  // Call 1: outline
  const { plan, usage: ou, meta: m2 } = await runNotesOutline({
    fixedSource: opts.fixedSource,
    pageText: opts.pageText,
    style: opts.style,
  })
  Object.assign(usage, addTokenUsage(usage, ou))
  let calls = 1

  const written = new Map<string, string>()
  let batchCount = 0

  // Remaining calls: write as many batches as budget allows; if only 1 left, write ALL sections in one call.
  const remaining = Math.max(0, maxCalls - calls)
  if (remaining <= 0) {
    fillMissingStubs(plan.sections, written)
  } else if (remaining === 1 || plan.sections.length <= plan.batchSize) {
    batchCount = 1
    calls += 1
    const filled = await askNotesJson({
      fixedSource: opts.fixedSource,
      task: taskNotesBatch({
        style: opts.style,
        wordsPerMin: plan.wordsPerMin,
        sections: plan.sections,
        meta: m2,
      }),
    })
    Object.assign(usage, addTokenUsage(usage, filled.usage))
    const parts = parseBatchParts(filled.value, plan.sections)
    for (const [k, v] of parts) written.set(k, v)
  } else {
    const batches = chunkSections(plan.sections, plan.batchSize).slice(
      0,
      remaining,
    )
    for (const batch of batches) {
      batchCount += 1
      calls += 1
      try {
        const filled = await askNotesJson({
          fixedSource: opts.fixedSource,
          task: taskNotesBatch({
            style: opts.style,
            wordsPerMin: plan.wordsPerMin,
            sections: batch,
            meta: m2,
          }),
        })
        Object.assign(usage, addTokenUsage(usage, filled.usage))
        const parts = parseBatchParts(filled.value, batch)
        for (const [k, v] of parts) written.set(k, v)
      } catch (err) {
        console.warn('notes batch failed', batchCount, err)
      }
    }
  }

  fillMissingStubs(plan.sections, written)
  const k2 = assembleNote(plan.sections, written, plan.transitions)

  return {
    k2,
    topics: plan.topics.length ? plan.topics : plan.sections.map((s) => s.title),
    staged: true,
    sections: plan.sections.length,
    batches: batchCount,
    rewrites: 0,
    usage,
    meta: m2,
  }
}
