import { markdownToSpeechText, splitForSpeech } from '@/lib/tts'
import { splitStudyTopics } from '@/lib/splitStudyTopics'
import { supabase } from './supabase'
import { extractFunctionsError } from './functionsError'

/** Speakable chunk for TTS only (not shown as “bölüm”). */
export type OverviewTurn = {
  host: 'T'
  name: string
  text: string
}

export type AudioOverviewScript = {
  title: string
  /** Continuous teacher lecture (spoken prose). */
  narration: string
  /** TTS chunks derived from narration */
  turns: OverviewTurn[]
  format?: 'lecture'
  source?: 'heuristic' | 'ai'
}

const CACHE_PREFIX = 'studium.audioOverview.v7:'
const TEACHER_NAME = 'Hoca'
/** Prefer longer TTS chunks so speech feels continuous */
const TTS_CHUNK_TARGET = 720
/** Per-topic source budget sent to the edge (detail without dumping the whole book). */
const TOPIC_BODY_BUDGET = 10000

function cacheKey(input: {
  title: string
  summary?: string | null
  markdown?: string | null
}) {
  const raw = `lecture|${input.title}|${(input.summary || '').slice(0, 200)}|${(
    input.markdown || ''
  ).slice(0, 400)}`
  let h = 0
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0
  return CACHE_PREFIX + String(h)
}

export function loadCachedAudioOverview(input: {
  title: string
  summary?: string | null
  markdown?: string | null
}): AudioOverviewScript | null {
  try {
    const raw = localStorage.getItem(cacheKey(input))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return normalizeAudioOverviewScript(parsed, input.title)
  } catch {
    return null
  }
}

export function saveCachedAudioOverview(
  input: {
    title: string
    summary?: string | null
    markdown?: string | null
  },
  script: AudioOverviewScript,
): void {
  try {
    localStorage.setItem(cacheKey(input), JSON.stringify(script))
  } catch {
    /* ignore */
  }
}

/** Group sentences into longer speakable chunks (no section titles). */
export function narrationToTurns(narration: string): OverviewTurn[] {
  const plain = markdownToSpeechText(narration).replace(/\s+/g, ' ').trim()
  if (plain.length < 40) return []

  const sentences = splitForSpeech(plain)
  const turns: OverviewTurn[] = []
  let buf = ''

  const flush = () => {
    const t = buf.replace(/\s+/g, ' ').trim()
    if (t.length >= 12) {
      turns.push({ host: 'T', name: TEACHER_NAME, text: t.slice(0, 1800) })
    }
    buf = ''
  }

  for (const s of sentences) {
    if (!buf) {
      buf = s
      continue
    }
    if (buf.length + 1 + s.length <= TTS_CHUNK_TARGET) {
      buf = `${buf} ${s}`
    } else {
      flush()
      buf = s
    }
  }
  flush()
  return turns.slice(0, 40)
}

function stripLessonChrome(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeAudioOverviewScript(
  raw: unknown,
  fallbackTitle: string,
): AudioOverviewScript | null {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as {
    title?: unknown
    narration?: unknown
    blog?: unknown
    turns?: unknown
    source?: unknown
  }
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim().slice(0, 120)
      : fallbackTitle.trim() || 'Ünite'

  let narration = ''
  if (typeof obj.narration === 'string' && obj.narration.trim().length > 80) {
    narration = stripLessonChrome(obj.narration).slice(0, 14000)
  } else if (typeof obj.blog === 'string' && obj.blog.trim().length > 80) {
    // Legacy blog → flatten headings into continuous prose
    narration = stripLessonChrome(obj.blog).slice(0, 14000)
  }

  if (!narration && Array.isArray(obj.turns)) {
    const bits: string[] = []
    for (const row of obj.turns) {
      if (!row || typeof row !== 'object') continue
      const r = row as { text?: unknown; markdown?: unknown; section?: unknown }
      const piece =
        String(r.markdown || r.text || '')
          .replace(/\s+/g, ' ')
          .trim() || ''
      if (piece.length < 8) continue
      const sec =
        typeof r.section === 'string' && r.section.trim()
          ? r.section.trim()
          : ''
      // Fold old section labels into spoken transitions, not headers
      bits.push(sec ? `${sec}. ${piece}` : piece)
    }
    narration = bits.join(' ').replace(/\s+/g, ' ').trim().slice(0, 14000)
  }

  narration = narration.replace(/\s+/g, ' ').trim()
  if (narration.length < 80) return null

  // Soft paragraph breaks for reading (~every 2–4 sentences) without “bölüm”
  const display = softParagraphs(narration)

  const turns = narrationToTurns(display)
  if (!turns.length) return null

  return {
    title,
    narration: display,
    turns,
    format: 'lecture',
    source: obj.source === 'heuristic' ? 'heuristic' : 'ai',
  }
}

/** Insert blank lines every few sentences so the UI reads like speech, not a wall. */
function softParagraphs(text: string): string {
  const sentences = splitForSpeech(text.replace(/\s+/g, ' ').trim())
  if (sentences.length <= 3) return sentences.join(' ')
  const paras: string[] = []
  let buf: string[] = []
  for (const s of sentences) {
    buf.push(s)
    const joined = buf.join(' ')
    if (buf.length >= 3 && joined.length >= 280) {
      paras.push(joined)
      buf = []
    }
  }
  if (buf.length) paras.push(buf.join(' '))
  return paras.join('\n\n')
}

/** Pack chapter topics so the model teaches each block in depth. */
export function packLectureTopics(
  markdown: string | null | undefined,
  title: string,
): { title: string; body: string }[] {
  const topics = splitStudyTopics((markdown || '').trim(), title).slice(0, 8)
  if (!topics.length) {
    const plain = markdownToSpeechText(markdown || '').trim()
    if (plain.length < 40) return []
    return [{ title: title || 'Konu', body: plain.slice(0, TOPIC_BODY_BUDGET) }]
  }
  const per = Math.max(
    900,
    Math.floor(TOPIC_BODY_BUDGET / Math.max(1, topics.length)),
  )
  return topics.map((t) => ({
    title: t.title.slice(0, 100),
    body: markdownToSpeechText(t.body || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, per),
  }))
}

/**
 * AI continuous teacher lecture. Falls back to local heuristic on failure.
 * Depth strategy: send structured topics with fat bodies; model expands each
 * in spoken form, then stitches one monologue (tone stays “hoca”).
 */
export async function generateAudioOverview(input: {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  force?: boolean
}): Promise<AudioOverviewScript> {
  if (!input.force) {
    const cached = loadCachedAudioOverview(input)
    if (cached && cached.turns.length >= 2 && cached.narration.length >= 400) {
      return { ...cached, source: 'ai', format: 'lecture' }
    }
  }

  const topics = packLectureTopics(input.markdown, input.title.trim() || 'Ünite')

  const { data, error } = await supabase.functions.invoke(
    'generate-audio-overview',
    {
      body: {
        title: input.title,
        summary: input.summary || '',
        key_concepts: input.keyConcepts || [],
        markdown: (input.markdown || '').slice(0, 8000),
        topics,
        format: 'lecture',
      },
    },
  )

  if (error) {
    throw new Error(await extractFunctionsError(error, data))
  }
  if (data?.error) throw new Error(String(data.error))

  const normalized = normalizeAudioOverviewScript(
    data?.script ?? data,
    input.title,
  )
  if (!normalized || normalized.narration.length < 400) {
    throw new Error('AI ders anlatımı çok kısa döndü')
  }

  const script: AudioOverviewScript = {
    ...normalized,
    source: 'ai',
    format: 'lecture',
  }
  saveCachedAudioOverview(input, script)
  return script
}

export function buildAudioOverview(input: {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
}): AudioOverviewScript {
  return buildLectureOverview(input)
}

/**
 * Continuous classroom monologue (heuristic) — sounds like a teacher talking,
 * not a summary and not a sectioned blog.
 */
function buildLectureOverview(input: {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
}): AudioOverviewScript {
  const title = input.title.trim() || 'Ünite'
  const concepts = (input.keyConcepts ?? []).filter(Boolean).slice(0, 8)
  const topics = splitStudyTopics(
    (input.markdown || input.summary || '').trim(),
    title,
  ).slice(0, 8)
  const briefing =
    (input.summary || '').trim() ||
    topics[0]?.summary ||
    'Bu ünitenin ana hatlarını adım adım işleyeceğiz.'

  const parts: string[] = []

  parts.push(
    `Merhaba, defterinizi açın. Bugün “${title}” konusunu işleyeceğiz. ` +
      `Başlamadan önce bir saniye durun: bu konu neden masada? Çünkü sınavda da uygulamada da karşınıza çıkacak bir omurga. ` +
      `${clip(briefing, 480)} ` +
      `Ben size şimdi özet okumayacağım; tahtadaymışız gibi anlatacağım. Ara sıra “bakın burası kritik” diyeceğim — o anları kaçırmayın.`,
  )

  if (concepts.length) {
    parts.push(
      `Önce omurgayı kuralım. Bu ünitede sık duyacağınız kavramlar şunlar: ${concepts.join(', ')}. ` +
        `Bunları ezber listesi gibi okumayın. Birini duyduğunuzda diğerine nasıl bağlandığını sorun. ` +
        (concepts[0]
          ? `Örneğin “${concepts[0]}” dediğimizde aklınıza hemen şunu getirin: ${clip(
              findConceptLine(input.markdown || '', concepts[0]) ||
                'tanımı kendi cümlelerinizle kurmadan ilerlemeyin.',
              260,
            )} `
          : '') +
        `Hazırsanız içeriğe geçiyoruz.`,
    )
  }

  topics.forEach((topic, idx) => {
    const plain = markdownToSpeechText(topic.body || '')
    const meat =
      topic.summary ||
      firstSentences(plain, 8) ||
      firstSentences(plain, 4) ||
      topic.title
    const deeper = clip(firstSentences(plain, 18) || meat, 1600)
    const extra = clip(firstSentences(plain.slice(plain.length / 3), 10), 900)
    const bridge =
      idx === 0
        ? `İlk olarak “${topic.title}” ile başlıyoruz.`
        : `Şimdi sıradaki başlığa geliyoruz: “${topic.title}”. Öncekiyle bağını koparmayın.`

    parts.push(
      `${bridge} ` +
        `Tanımı kendi dilimizle kuralım. ${clip(meat, 520)} ` +
        `Neden önemli, diye sorarsanız: çünkü bu parça olmadan önceki kısım havada kalır; sınavda da buradan soru gelir. ` +
        `Kaynağın söylediğini açıyorum: ${deeper} ` +
        (extra && extra.length > 80
          ? `Biraz daha detaya inelim. ${extra} `
          : '') +
        `Dikkat edin — burayı aceleyle geçmeyin. Kendi kelimenizle bir cümle kuramıyorsanız, henüz oturmamış demektir.`,
    )
  })

  if (concepts.length > 1) {
    parts.push(
      `Bir de sınav tuzağına değineyim. En çok “${concepts[0]}” ile “${concepts[1]}” karışıyor. ` +
        `İkisini yan yana koyun: ortak yanları nedir, ayrım çizgisi nerededir? ` +
        `Benim önerim şu: her biri için tek cümlelik ayırt edici özellik yazın. Ezber değil, karşılaştırma. ` +
        (concepts[2]
          ? `Üçüncü bir tuzak da “${concepts[2]}” ile karıştırmak olabilir; onu da kenara not edin. `
          : '') +
        `Bu ayrımı kurduğunuz anda konu gerçekten sizin olur.`,
    )
  }

  parts.push(
    `Toparlıyorum. “${title}” için çerçeveyi kurduk, ana parçaları işledik` +
      (concepts.length
        ? `, omurgayı tekrar hatırlayın: ${concepts.slice(0, 5).join(', ')}. `
        : '. ') +
      `Sınıftan çıkmadan şunu yapın: bu dersten üç ana fikri kendi cümlelerinizle yazın, birini sesli anlatın. ` +
      `Takıldığınız yerde notlara dönün. Sorunuz kalırsa o sayfa sizin haritanız. İyi çalışmalar.`,
  )

  const narration = softParagraphs(parts.join(' '))
  const turns = narrationToTurns(narration)

  return {
    title,
    narration,
    turns,
    format: 'lecture',
    source: 'heuristic',
  }
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1).trim()}…`
}

function firstSentences(text: string, count: number) {
  return splitForSpeech(text).slice(0, count).join(' ')
}

function findConceptLine(md: string, term: string): string | null {
  if (!md || !term) return null
  const lines = md.split(/\n+/).map((l) => l.replace(/^#+\s*/, '').trim())
  const hit = lines.find((l) =>
    l.toLowerCase().includes(term.toLowerCase().slice(0, 28)),
  )
  return hit ? markdownToSpeechText(hit) : null
}
