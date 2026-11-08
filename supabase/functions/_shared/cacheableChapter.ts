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
export const CACHE_LAYOUT_VERSION = 'v9b-notes-json-safe'

/**
 * Stable system head including ALL output schemas.
 * Keeping schemas here (not in GÖREV) maximizes Cache Hit % on warm calls.
 */
export const CHAPTER_CACHE_SYSTEM = `Studium cache-layout ${CACHE_LAYOUT_VERSION}
Sen Studium ders asistanısın (Türkçe, akademik, doğal dil).
SOURCE ve atlas sabittir. Sadece user’daki GÖREV kodunu uygula.
Kurallar: uydurma yok; SOURCE dışı bilgi yok; geçerli JSON dışında metin yok; fence yok.
Konu sapması YASAK: charter/objective/must_cover dışına genel giriş yazma.

=== ÇIKTI ŞEMALARI (GÖREV bunlardan birini seçer) ===
NOTES → {"k2":"markdown max~4800; ## bölümler; tanım+örnek+yanılgı","topics":["kısa etiketler"]}
NOTES_OUTLINE → {"sections":[{"id":"s1","title":"SOURCE başlık","minutes":10,"goals":["Bloom fiiliyle hedef"],"must":["nokta"],"source_hook":"çengel","tasks":["content","example","table","visual"]}],"transitions":[{"fromSectionId":"s1","toSectionId":"s2","sentence":"geçiş"}],"topics":["etiket"]}
  Aşama1: 5–8 section; minutes toplamı süreye eşit; ilk≈Giriş/bağlam, son≈Özet/değerlendirme; title SOURCE’tan; metin YAZMA.
NOTES_BATCH → {"parts":[{"id":"s1","markdown":"## Başlık\\n… (max~950 kelime; örnek+tablo+mermaid tasks’e göre)"}]}
  Aşama2: yalnız verilen section’lar; id koru; markdown içinde GERÇEK newline YASAK — yalnızca \\n; JSON’u yarım bırakma.
NOTES_REWRITE → {"id":"s1","markdown":"## … düzeltilmiş tam bölüm (\\n kaçışlı)"}
  Evaluator sonrası tek bölüm; SOURCE’a sadık; geçerli JSON zorunlu.
BRIEF → {"markdown":"K1 markdown max~900"}
DETAILED → {"markdown":"K3 markdown max~6500; 6–14 ##; tablo+Dikkat; atlas kapsamı; eksiksiz"}
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
const TOPIC_SOURCE_PACK_CHARS = 14_000

/** Same temperature for every task in a cache chain. */
export const CHAPTER_CACHE_TEMPERATURE = 0.2

/**
 * Same max_tokens on EVERY cacheable call (notes/brief/detailed/…).
 * Differing max_tokens was correlated with “first artifact after notes”
 * always Cache Miss while later kinds Hit.
 */
/** Per-section quality writes need headroom (~dk×120–160 kelime). */
export const CHAPTER_CACHE_MAX_TOKENS = 4200

/** Topic-study SOURCE chapters embed this header in page_text. */
export function isTopicPageText(pageText: string): boolean {
  return /---\s*Topic (unit|research)\s*---/i.test(pageText)
}

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
  const packChars = isTopicPageText(pageText)
    ? TOPIC_SOURCE_PACK_CHARS
    : SOURCE_PACK_CHARS
  const body = packPageTextForMindMap(pageText, packChars)

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
  /**
   * Notes/write quality: allow JSON repair+retry (1 extra LLM if parse fails).
   * Mind-map warm path can keep false to save Edge CPU.
   */
  allowRepair?: boolean
  retries?: number
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
    retries: opts.retries ?? (opts.allowRepair ? 2 : 1),
    skipRepairCall: opts.allowRepair !== true,
  })
}

/** ——— Tiny task codes (keep miss tokens minimal) ——— */

export function taskNotes(input: {
  pageNums: number[]
  chunkIndex?: number
  totalChunks?: number
  style?: string | null
  /** Topic books need a real lesson, not a 1-page skim. */
  topicSource?: boolean
}): string {
  const stil =
    String(input.style || '').trim() || 'sade, sınav odaklı, örnekli'
  const pages =
    input.pageNums.length > 0
      ? input.pageNums.join(',')
      : 'SOURCE’taki tüm sayfalar'
  if (input.topicSource) {
    return `NOTES | sayfalar ${pages} | KONU_KAYNAĞI | SOURCE’taki timed_beats/must_cover/deep_dives’ı işle | min~3000 char yoğun ders | ## başlıklar | örnek+yanılgı+checkpoint | stil:${stil} | şema NOTES`
  }
  return `NOTES | sayfalar ${pages} | tek geçiş | yoğun tut | stil:${stil} | şema NOTES`
}

export function taskNotesOutline(input: {
  style?: string | null
  sectionCount: number
  totalMinutes: number
  meta: {
    minutes: number
    objective: string
    charter: string
    core: string
    beats: string
    mustLearn: string
  }
}): string {
  const stil =
    String(input.style || '').trim() || 'sade, sınav odaklı, örnekli'
  const m = input.meta
  const n = Math.max(4, Math.min(8, input.sectionCount))
  const total = input.totalMinutes || m.minutes || 90
  return `NOTES_OUTLINE | Aşama1 PLANNER | ${n} section | minutes TOPLAM=${total} | ilk≈Giriş/bağlam ~10 | son≈Özet/değerlendirme ~10 | goals Bloom fiili | tasks:content(+example|table|visual) | transitions ardışık | title SOURCE’tan | METİN YAZMA | hedef:${(m.charter || m.objective || m.core || 'SOURCE').slice(0, 110)} | must:${(m.mustLearn || m.beats || 'SOURCE').slice(0, 140)} | stil:${stil} | şema NOTES_OUTLINE`
}

export function taskNotesBatch(input: {
  style?: string | null
  wordsPerMin: { min: number; max: number }
  sections: Array<{
    id: string
    title: string
    minutes: number
    goals: string[]
    must: string[]
    source_hook: string
    tasks: string[]
  }>
  meta: {
    objective: string
    charter: string
  }
}): string {
  const stil =
    String(input.style || '').trim() || 'sade, sınav odaklı, örnekli'
  const goal = (input.meta.charter || input.meta.objective || '').slice(0, 100)
  const plan = input.sections
    .map((s) => {
      const wMin = Math.min(
        950,
        Math.round(s.minutes * input.wordsPerMin.min),
      )
      const wMax = Math.min(
        950,
        Math.round(s.minutes * input.wordsPerMin.max),
      )
      const must = (s.must || []).slice(0, 3).join('; ')
      const tasks = (s.tasks || ['content']).join('+')
      return `${s.id}「${s.title}」${s.minutes}dk ${wMin}-${wMax}kelime tasks:${tasks} goals:${(s.goals || []).slice(0, 2).join(';').slice(0, 80)} hook:${(s.source_hook || '').slice(0, 50)} must:${must.slice(0, 80)}`
    })
    .join(' || ')
  return `NOTES_BATCH | Aşama2 WRITER | hedef:${goal || 'SOURCE'} | örnek+tablo+mermaid(tasks) | markdown string’de satır=\\n (ham newline YASAK) | JSON’u kesme | sapma YASAK | stil:${stil} | yaz:${plan.slice(0, 1000)} | şema NOTES_BATCH`
}

export function taskNotesRewrite(input: {
  style?: string | null
  section: {
    id: string
    title: string
    minutes: number
    goals: string[]
    must: string[]
    source_hook: string
    tasks: string[]
  }
  wordsPerMin: { min: number; max: number }
  issues: string[]
  priorMarkdown: string
  meta: {
    objective: string
    charter: string
  }
}): string {
  const stil =
    String(input.style || '').trim() || 'sade, sınav odaklı, örnekli'
  const s = input.section
  const wMin = Math.min(950, Math.round(s.minutes * input.wordsPerMin.min))
  const wMax = Math.min(950, Math.round(s.minutes * input.wordsPerMin.max))
  const goal = (input.meta.charter || input.meta.objective || '').slice(0, 80)
  const issues = (input.issues || []).slice(0, 4).join('; ').slice(0, 160)
  const prior = String(input.priorMarkdown || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900)
  return `NOTES_REWRITE | EVALUATOR fix | ${s.id}「${s.title}」${s.minutes}dk ${wMin}-${wMax}kelime tasks:${(s.tasks || []).join('+')} | issues:${issues || 'zayıf'} | hedef:${goal || 'SOURCE'} | hook:${(s.source_hook || '').slice(0, 50)} | prior:${prior} | markdown’te \\n | JSON kesme YASAK | stil:${stil} | şema NOTES_REWRITE`
}

export function taskDetailedOneShot(style?: string | null, topicSource?: boolean): string {
  const stil = String(style || '').trim() || 'sade, sınav odaklı, örnekli'
  if (topicSource) {
    return `DETAILED | KONU_KAYNAĞI | stil:${stil} | şema DETAILED | SOURCE müfredatını eksiksiz işle | kısa özet yasak`
  }
  return `DETAILED | stil:${stil} | şema DETAILED`
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
