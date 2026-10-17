import { markdownToSpeechText, splitForSpeech } from '@/lib/tts'
import { splitStudyTopics } from '@/lib/splitStudyTopics'
import { supabase } from './supabase'
import { extractFunctionsError } from './functionsError'

export type OverviewTurn = {
  host: 'A' | 'B'
  name: string
  text: string
}

export type AudioOverviewScript = {
  title: string
  turns: OverviewTurn[]
  /** heuristic | ai */
  source?: 'heuristic' | 'ai'
}

const CACHE_PREFIX = 'studium.audioOverview.v1:'

function cacheKey(input: {
  title: string
  summary?: string | null
  markdown?: string | null
}) {
  const raw = `${input.title}|${(input.summary || '').slice(0, 200)}|${(
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
    const parsed = JSON.parse(raw) as AudioOverviewScript
    if (!parsed?.turns?.length) return null
    return normalizeAudioOverviewScript(parsed, input.title)
  } catch {
    return null
  }
}

export function saveCachedAudioOverview(
  input: { title: string; summary?: string | null; markdown?: string | null },
  script: AudioOverviewScript,
): void {
  try {
    localStorage.setItem(cacheKey(input), JSON.stringify(script))
  } catch {
    /* ignore */
  }
}

export function normalizeAudioOverviewScript(
  raw: unknown,
  fallbackTitle: string,
): AudioOverviewScript {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as {
    title?: unknown
    turns?: unknown
    source?: unknown
  }
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim().slice(0, 120)
      : fallbackTitle.trim() || 'Ünite'

  const turns: OverviewTurn[] = []
  if (Array.isArray(obj.turns)) {
    for (const row of obj.turns) {
      if (!row || typeof row !== 'object') continue
      const r = row as { host?: unknown; name?: unknown; text?: unknown }
      const text = String(r.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 420)
      if (text.length < 8) continue
      const hostRaw = String(r.host || r.name || 'A').toUpperCase()
      const host: 'A' | 'B' =
        hostRaw.startsWith('B') || /barış|baris/i.test(String(r.name || ''))
          ? 'B'
          : 'A'
      turns.push({
        host,
        name: host === 'A' ? 'Ada' : 'Barış',
        text,
      })
      if (turns.length >= 14) break
    }
  }

  // Soft-fix consecutive same-host turns
  for (let i = 1; i < turns.length; i++) {
    if (turns[i]!.host === turns[i - 1]!.host) {
      const host: 'A' | 'B' = turns[i - 1]!.host === 'A' ? 'B' : 'A'
      turns[i] = {
        ...turns[i]!,
        host,
        name: host === 'A' ? 'Ada' : 'Barış',
      }
    }
  }

  return {
    title,
    turns,
    source: obj.source === 'ai' ? 'ai' : turns.length ? 'ai' : 'heuristic',
  }
}

/**
 * AI podcast script via edge function. Falls back to local heuristic on failure.
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
    if (cached && cached.turns.length >= 6) return { ...cached, source: 'ai' }
  }

  const { data, error } = await supabase.functions.invoke(
    'generate-audio-overview',
    {
      body: {
        title: input.title,
        summary: input.summary || '',
        key_concepts: input.keyConcepts || [],
        markdown: (input.markdown || '').slice(0, 4500),
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
  if (normalized.turns.length < 4) {
    throw new Error('AI senaryo çok kısa döndü')
  }

  const script: AudioOverviewScript = { ...normalized, source: 'ai' }
  saveCachedAudioOverview(input, script)
  return script
}

/**
 * NotebookLM-inspired fallback: two hosts from notes (no LLM).
 */
export function buildAudioOverview(input: {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
}): AudioOverviewScript {
  const title = input.title.trim() || 'Ünite'
  const concepts = (input.keyConcepts ?? []).filter(Boolean).slice(0, 6)
  const topics = splitStudyTopics(
    (input.markdown || input.summary || '').trim(),
    title,
  )
  const briefing =
    (input.summary || '').trim() ||
    topics[0]?.summary ||
    'Bu ünitenin ana hatlarını birlikte tarayalım.'

  const turns: OverviewTurn[] = []

  turns.push({
    host: 'A',
    name: 'Ada',
    text: `Merhaba — bugün “${title}” ünitesine bakıyoruz. Kısa bir çerçeve: ${clip(briefing, 220)}`,
  })

  turns.push({
    host: 'B',
    name: 'Barış',
    text:
      concepts.length > 0
        ? `Öne çıkan kavramlar: ${concepts.slice(0, 4).join(', ')}. Hangisinden başlayalım?`
        : `Bu ünitede net bir omurga var mı, yoksa dağınık mı duruyor sence?`,
  })

  turns.push({
    host: 'A',
    name: 'Ada',
    text:
      concepts[0]
        ? `Önce “${concepts[0]}”. ${clip(
            findConceptLine(input.markdown || '', concepts[0]) ||
              topics[0]?.summary ||
              'Temel tanımı netleştirelim.',
            240,
          )}`
        : clip(topics[0]?.summary || briefing, 240),
  })

  for (const topic of topics.slice(0, 4)) {
    const body = clip(
      topic.summary ||
        firstSentences(markdownToSpeechText(topic.body || ''), 2) ||
        topic.title,
      260,
    )
    turns.push({
      host: 'B',
      name: 'Barış',
      text: `Peki “${topic.title}” — burası neden kritik?`,
    })
    turns.push({
      host: 'A',
      name: 'Ada',
      text: body,
    })
  }

  if (concepts.length > 1) {
    turns.push({
      host: 'B',
      name: 'Barış',
      text: `Özetleyelim: ${concepts.slice(0, 5).join(' · ')}. Sınavda hangisi tuzak olur?`,
    })
    turns.push({
      host: 'A',
      name: 'Ada',
      text: `Genelde “${concepts[0]}” ile “${concepts[1] || concepts[0]}” karışıyor. Ayrımı kendi cümlelerinle yazmayı dene.`,
    })
  }

  turns.push({
    host: 'B',
    name: 'Barış',
    text: `Bugünkü tur bu kadar. Flash veya quiz ile pekiştirebilirsin — “${title}” artık daha tanıdık.`,
  })
  turns.push({
    host: 'A',
    name: 'Ada',
    text: 'Dinlediğin için teşekkürler. İyi çalışmalar.',
  })

  return { title, turns, source: 'heuristic' }
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
