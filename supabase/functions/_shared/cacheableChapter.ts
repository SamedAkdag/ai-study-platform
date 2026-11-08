/**
 * MiMo / Token Harbor prompt-cache layout:
 *
 *   system = [RULES + JSON ŞEMALARI + FIXED_SOURCE]  ← byte-identical every call
 *   user   = [kısa GÖREV kodu]                       ← only this changes (~tens of tokens)
 *
 * Warm calls should show cached_tokens ≈ almost all of prompt_tokens.
 * First call is always Cache Miss (writes KV). Input Σ still sums full
 * prompt_tokens each time — look at Miss vs Cache, not Input Σ alone.
 *
 * FIXED_SOURCE: only page_text + title + style (never mutable page_sources).
 */

import {
  llmCompleteJson,
  type ChatMessage,
  type LlmResult,
  type TokenUsage,
} from './llm.ts'
import {
  buildPageAtlas,
  extractPdfTocCandidates,
  formatPdfTocCandidates,
  packPageTextForMindMap,
} from './mindMapGen.ts'

/**
 * Bump when system/FIXED layout changes — notes + artifacts must be
 * redeployed together (Supabase bundles _shared per function).
 */
export const CACHE_LAYOUT_VERSION = 'v6b-mindmap-noun-labels'

/**
 * Stable system head including ALL output schemas.
 * Keeping schemas here (not in GÖREV) maximizes Cache Hit % on warm calls.
 */
export const CHAPTER_CACHE_SYSTEM = `Studium cache-layout ${CACHE_LAYOUT_VERSION}
Sen Studium ders asistanısın (Türkçe, akademik, doğal dil).
SOURCE ve atlas sabittir. Sadece user’daki GÖREV kodunu uygula.
Kurallar: uydurma yok; SOURCE dışı bilgi yok; geçerli JSON dışında metin yok; fence yok.

=== ÇIKTI ŞEMALARI (GÖREV bunlardan birini seçer) ===
NOTES → {"k2":"markdown max~1600","topics":["kısa etiketler sayfa sırasıyla"]}
BRIEF → {"markdown":"K1 markdown max~700"}
DETAILED → {"markdown":"K3 markdown max~3200; 5–12 ##; tablo+Dikkat; atlas kapsamı"}
PRACTICE → {"examples":[{"problem":"…","solution_steps":["1","2","3"]}],"quiz":[{"question":"…","options":["A","B","C","D"],"correct_index":0,"explanation":"…"}],"flashcards":[{"role":"hook|teach|concept|check|trap|summary","front":"…","back":"…"}]}
  (2 örnek, 4 quiz, 8–10 flash; zihin haritası YOK)

ZİHİN HARİTASI — iki aşama:
MINDMAP_SKEL → {"mind_map":{"central":"omurga ≤5 kelime","branches":[{"label":"konu","page":12,"children":[]}]}}
  Aşama1: 5–9 ana; children []. Öncelik PDF ADAY BAŞLIKLAR > SAYFA ATLASI.
  label = TAM isim öbeği (≤6 kelime). İyi: "Limit Tanımı". Kötü: "Limit bir noktaya yaklaşırken".
  YASAK: yarım cümle, tanım cümlesi, Birinci bölüm, Bölüm N, yalnız sayı, yarım kelime.
MINDMAP_FILL → {"mind_map":{"central":"…","branches":[{"label":"aynı ana","page":12,"children":["alt1","alt2"]}]}}
  Aşama2: iskelet label/page KORU; her ana 3–7 alt = kısa isim öbeği (tanım cümlesi değil).
  narration ayrı alan — label’e yazma. Dayanaksız alt yok.
MINDMAP → yedek tek geçiş; mümkünse SKEL+FILL. narration opsiyonel.`

const SOURCE_PACK_CHARS = 8000

/** Same temperature for every task in a cache chain. */
export const CHAPTER_CACHE_TEMPERATURE = 0.2

/**
 * Same max_tokens on EVERY cacheable call (notes/brief/detailed/…).
 * Differing max_tokens was correlated with “first artifact after notes”
 * always Cache Miss while later kinds Hit.
 */
export const CHAPTER_CACHE_MAX_TOKENS = 3400

/**
 * Byte-stable prefix body. Do NOT put style here — notes default style
 * ("Clear textbook…") vs artifact DB style used to diverge and force Cache Miss
 * on detailed while brief/map still hit a later warm prefix.
 */
export function buildChapterFixedSource(input: {
  title: string
  pageText: string
  pageSources?: unknown
  /** @deprecated Ignored — keep style only in the tiny GÖREV string. */
  style?: string | null
}): string {
  const title = String(input.title || 'Ünite').trim() || 'Ünite'
  const pageText = String(input.pageText || '')

  const atlas = buildPageAtlas(pageText, [], 28)
  const toc = formatPdfTocCandidates(extractPdfTocCandidates(pageText))
  const body = packPageTextForMindMap(pageText, SOURCE_PACK_CHARS)

  return [
    `ÜNİTE: ${title}`,
    `=== SAYFA ATLASI ===`,
    atlas || '(atlas yok)',
    `=== PDF ADAY BAŞLIKLAR ===`,
    toc || '(aday yok)',
    `=== SOURCE ===`,
    body || '(SOURCE boş)',
  ].join('\n\n')
}

/** Short fingerprint for usage meta / debugging prefix mismatches. */
export function fixedSourceFingerprint(fixedSource: string): string {
  let h = 2166136261
  for (let i = 0; i < fixedSource.length; i += 1) {
    h ^= fixedSource.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `h${(h >>> 0).toString(16)}_n${fixedSource.length}`
}

export function estimatePrefixTokens(fixedSource: string): number {
  return Math.ceil(
    (CHAPTER_CACHE_SYSTEM.length + 2 + fixedSource.length) / 4,
  )
}

export function buildCacheableMessages(
  fixedSource: string,
  task: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${CHAPTER_CACHE_SYSTEM}\n\n${fixedSource}`,
    },
    {
      role: 'user',
      content: `GÖREV: ${task.trim()}`,
    },
  ]
}

export type CacheableAskOpts = {
  fixedSource: string
  task: string
  /** Ignored — always CHAPTER_CACHE_MAX_TOKENS for prefix-cache identity. */
  maxTokens?: number
  temperature?: number
}

export async function askCacheableJson(
  opts: CacheableAskOpts,
): Promise<{
  value: Record<string, unknown>
  provider: LlmResult['provider']
  usage: TokenUsage
}> {
  return llmCompleteJson({
    messages: buildCacheableMessages(opts.fixedSource, opts.task),
    temperature: opts.temperature ?? CHAPTER_CACHE_TEMPERATURE,
    maxTokens: CHAPTER_CACHE_MAX_TOKENS,
    retries: 1,
    skipRepairCall: true,
  })
}

/** ——— Tiny task codes (keep miss tokens minimal) ——— */

export function taskNotes(input: {
  pageNums: number[]
  chunkIndex?: number
  totalChunks?: number
  style?: string | null
}): string {
  const stil =
    String(input.style || '').trim() || 'sade, sınav odaklı, örnekli'
  const pages =
    input.pageNums.length > 0
      ? input.pageNums.join(',')
      : 'SOURCE’taki tüm sayfalar'
  return `NOTES | sayfalar ${pages} | tek geçiş | stil:${stil} | şema NOTES`
}

export function taskBrief(style?: string | null): string {
  const stil = String(style || '').trim() || 'sade, sınav odaklı, örnekli'
  return `BRIEF | stil:${stil} | şema BRIEF | bilgi ekleme`
}

export function taskDetailedOutline(): string {
  return `DETAILED_OUTLINE | 5–12 section iskelet | JSON sections[]`
}

export function taskDetailedFill(outlineJson: string): string {
  return `DETAILED_FILL | şema DETAILED | iskelet:${outlineJson.slice(0, 1200)}`
}

export function taskDetailedOneShot(style?: string | null): string {
  const stil = String(style || '').trim() || 'sade, sınav odaklı, örnekli'
  return `DETAILED | stil:${stil} | şema DETAILED`
}

export function taskPractice(style?: string | null): string {
  const stil = String(style || '').trim() || 'sade, sınav odaklı, örnekli'
  return `PRACTICE | stil:${stil} | şema PRACTICE`
}

export function taskMindMapSkeleton(): string {
  return `MINDMAP_SKEL | Aşama1 | 5–9 ana | children=[] | label=TAM isim öbeği ≤6 kelime | İyi:"Limit Tanımı" Kötü:"Limit bir noktaya" | yarım cümle/tanım cümlesi/Birinci bölüm YASAK | şema MINDMAP_SKEL`
}

export function taskMindMapFill(skeletonJson: string): string {
  const skel = skeletonJson.replace(/\s+/g, ' ').trim().slice(0, 1400)
  return `MINDMAP_FILL | Aşama2 | label/page KORU | altlar=kısa isim öbeği (tanım/yarım cümle YASAK) | iskelet:${skel}`
}

export function taskMindMapOneShot(): string {
  return `MINDMAP | yedek | label=TAM isim öbeği | yarım cümle/tanım cümlesi/sayı-only YASAK | 5–9×3–7 | şema MINDMAP`
}
