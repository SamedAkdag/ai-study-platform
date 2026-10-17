import { splitStudyTopics } from '@/lib/splitStudyTopics'
import type { QuizItem } from '@/types/database'
import { supabase } from './supabase'
import { extractFunctionsError } from './functionsError'

export type StudyGuide = {
  title: string
  briefing: string
  keyTerms: Array<{ term: string; gloss: string }>
  mustKnow: string[]
  quizWarmup: Array<{ q: string; hint?: string }>
  essayPrompts: string[]
  source?: 'heuristic' | 'ai'
}

const CACHE_PREFIX = 'studium.studyGuide.v1:'

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

export function loadCachedStudyGuide(input: {
  title: string
  summary?: string | null
  markdown?: string | null
}): StudyGuide | null {
  try {
    const raw = localStorage.getItem(cacheKey(input))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StudyGuide
    if (!parsed?.briefing) return null
    return normalizeStudyGuide(parsed, input.title)
  } catch {
    return null
  }
}

export function saveCachedStudyGuide(
  input: { title: string; summary?: string | null; markdown?: string | null },
  guide: StudyGuide,
): void {
  try {
    localStorage.setItem(cacheKey(input), JSON.stringify(guide))
  } catch {
    /* ignore */
  }
}

export function normalizeStudyGuide(
  raw: unknown,
  fallbackTitle: string,
): StudyGuide {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim().slice(0, 120)
      : fallbackTitle.trim() || 'Ünite'

  const briefing = String(obj.briefing || '').trim().slice(0, 800)

  const keyTerms: StudyGuide['keyTerms'] = []
  if (Array.isArray(obj.keyTerms)) {
    for (const row of obj.keyTerms) {
      if (!row || typeof row !== 'object') continue
      const r = row as { term?: unknown; gloss?: unknown }
      const term = String(r.term || '').trim().slice(0, 80)
      const gloss = String(r.gloss || '').trim().slice(0, 280)
      if (term.length < 2) continue
      keyTerms.push({ term, gloss: gloss || 'Temel kavram.' })
      if (keyTerms.length >= 10) break
    }
  }

  const mustKnow = Array.isArray(obj.mustKnow)
    ? obj.mustKnow
        .map((x) => String(x || '').trim())
        .filter((x) => x.length >= 4)
        .slice(0, 10)
    : []

  const quizWarmup: StudyGuide['quizWarmup'] = []
  if (Array.isArray(obj.quizWarmup)) {
    for (const row of obj.quizWarmup) {
      if (!row || typeof row !== 'object') continue
      const r = row as { q?: unknown; hint?: unknown }
      const q = String(r.q || '').trim().slice(0, 280)
      if (q.length < 6) continue
      const hint = String(r.hint || '').trim().slice(0, 80)
      quizWarmup.push(hint ? { q, hint } : { q })
      if (quizWarmup.length >= 8) break
    }
  }

  const essayPrompts = Array.isArray(obj.essayPrompts)
    ? obj.essayPrompts
        .map((x) => String(x || '').trim())
        .filter((x) => x.length >= 8)
        .slice(0, 5)
    : []

  return {
    title,
    briefing:
      briefing ||
      'Bu ünite için brifing henüz yok — Anlatım üretildikten sonra dolar.',
    keyTerms,
    mustKnow,
    quizWarmup,
    essayPrompts,
    source: obj.source === 'heuristic' ? 'heuristic' : 'ai',
  }
}

export async function generateStudyGuide(input: {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  quiz?: QuizItem[] | null
  force?: boolean
}): Promise<StudyGuide> {
  if (!input.force) {
    const cached = loadCachedStudyGuide(input)
    if (cached && cached.mustKnow.length + cached.keyTerms.length >= 4) {
      return { ...cached, source: 'ai' }
    }
  }

  const { data, error } = await supabase.functions.invoke(
    'generate-study-guide',
    {
      body: {
        title: input.title,
        summary: input.summary || '',
        key_concepts: input.keyConcepts || [],
        markdown: (input.markdown || '').slice(0, 4500),
        quiz_questions: (input.quiz ?? [])
          .slice(0, 8)
          .map((q) => q.question)
          .filter(Boolean),
      },
    },
  )

  if (error) throw new Error(await extractFunctionsError(error, data))
  if (data?.error) throw new Error(String(data.error))

  const guide = normalizeStudyGuide(data?.guide ?? data, input.title)
  if (!guide.briefing || guide.briefing.length < 20) {
    throw new Error('AI kılavuz boş döndü')
  }
  const out: StudyGuide = { ...guide, source: 'ai' }
  saveCachedStudyGuide(input, out)
  return out
}

/** Local fallback from existing chapter materials. */
export function buildStudyGuide(input: {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  quiz?: QuizItem[] | null
}): StudyGuide {
  const title = input.title.trim() || 'Ünite'
  const markdown = (input.markdown || '').trim()
  const concepts = (input.keyConcepts ?? []).map((c) => c.trim()).filter(Boolean)
  const topics = splitStudyTopics(markdown || input.summary || '', title)

  const briefing =
    (input.summary || '').trim() ||
    topics
      .slice(0, 3)
      .map((t) => t.summary || t.title)
      .filter(Boolean)
      .join(' · ') ||
    'Bu ünite için kısa brifing henüz yok — Anlatım üretildikten sonra dolar.'

  const keyTerms = concepts.slice(0, 12).map((term) => {
    const gloss =
      findGlossNearTerm(markdown, term) ||
      topics.find((t) =>
        t.title.toLowerCase().includes(term.toLowerCase().slice(0, 24)),
      )?.summary ||
      'Anlatımda geçen temel kavram.'
    return { term, gloss: gloss.slice(0, 220) }
  })

  const mustKnow = topics
    .slice(0, 8)
    .map((t) => t.summary?.trim() || t.title)
    .filter(Boolean)

  const quizWarmup = (input.quiz ?? []).slice(0, 6).map((q) => ({
    q: q.question,
    hint:
      q.type === 'mcq'
        ? 'Çoktan seçmeli · Alıştır → Sınav'
        : q.type === 'true_false'
          ? 'Doğru / yanlış'
          : 'Kısa cevap',
  }))

  const essayPrompts = topics.slice(0, 4).map((t) => {
    const focus = t.title.replace(/^#+\s*/, '').trim()
    return `“${focus}” konusunu kendi cümlelerinle açıkla: tanım, neden önemli, bir örnek.`
  })

  if (essayPrompts.length === 0 && concepts[0]) {
    essayPrompts.push(
      `“${concepts[0]}” kavramını bir arkadaşına anlatır gibi özetle.`,
    )
  }

  return {
    title,
    briefing,
    keyTerms,
    mustKnow,
    quizWarmup,
    essayPrompts,
    source: 'heuristic',
  }
}

function findGlossNearTerm(markdown: string, term: string): string | null {
  if (!markdown || term.length < 2) return null
  const lower = markdown.toLowerCase()
  const idx = lower.indexOf(term.toLowerCase())
  if (idx < 0) return null
  const start = Math.max(0, idx - 40)
  const end = Math.min(markdown.length, idx + term.length + 160)
  const window = markdown.slice(start, end).replace(/\s+/g, ' ').trim()
  const sentence =
    window.match(/[^.!?…]*[.!?…]/)?.[0] ||
    window
  return sentence.replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/, '').trim() || null
}
