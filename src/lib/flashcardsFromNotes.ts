import type { FlashcardItem, QuizItem } from '@/types/database'
import {
  FLASH_ROLE_META,
  flashRoleSortKey,
  normalizeFlashRole,
  type FlashRole,
} from '@/lib/flashcardPedagogy'
import { markdownToSpeechText } from '@/lib/tts'

export type FlashcardKind =
  | 'concept'
  | 'callout'
  | 'section'
  | 'quiz'
  | 'summary'

export type Flashcard = {
  id: string
  kind: FlashcardKind
  role?: FlashRole
  /** Phase chip: Isın / Öğren / Kontrol / Pekiştir */
  phase?: string
  /** Short label shown as eyebrow */
  label: string
  front: string
  back?: string
  /** Plain text for TTS */
  speech: string
}

function stripMd(s: string): string {
  return markdownToSpeechText(s).trim()
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trim()}…`
}

/** Prefer AI-authored flashcards; fall back to notes/quiz extraction. */
export function flashcardsFromNotes(input: {
  title: string
  markdown: string
  keyConcepts?: string[] | null
  quiz?: QuizItem[] | null
  aiFlashcards?: FlashcardItem[] | null
  maxCards?: number
}): Flashcard[] {
  const max = input.maxCards ?? 18
  const fromAi = normalizeAiFlashcards(input.aiFlashcards, max)
  // Any AI deck wins — don't dilute with weak "Kavram" stubs
  if (fromAi.length > 0) return fromAi

  const cards: Flashcard[] = []
  const md = String(input.markdown || '')

  // 1) Key concepts — only when notes give a real definition (no stub backs)
  for (const raw of input.keyConcepts ?? []) {
    const concept = stripMd(raw)
    if (concept.length < 2) continue
    const hint = findConceptHint(md, concept)
    if (!hint) continue
    cards.push({
      id: `concept-${cards.length}`,
      kind: 'concept',
      label: 'Kavram',
      front: concept,
      back: hint,
      speech: `${concept}. ${hint}`,
    })
  }

  // 2) Callout blockquotes (Önemli, Tanım, Sınav kart, AI notu…)
  const calloutRe =
    /^>\s*\*\*(AI notu|Önemli|Kilit|Anahtar|Tanım|Kavram|Özet|Dikkat|Sınav\s*kart|Ezber|Benzetme)[^*]*\*\*[^\n]*\n((?:>.*\n?)*)/gim
  let m: RegExpExecArray | null
  while ((m = calloutRe.exec(md)) !== null) {
    const label = m[1]!.replace(/\s+/g, ' ').trim()
    const body = stripMd(
      m[0]!
        .split('\n')
        .map((line) => line.replace(/^>\s?/, ''))
        .join('\n'),
    )
    if (body.length < 12) continue
    cards.push({
      id: `callout-${cards.length}`,
      kind: 'callout',
      label,
      front: clip(body, 220),
      speech: body,
    })
  }

  // 3) ## / ### sections → heading + first paragraph
  const sectionRe = /^(#{2,3})\s+(.+)\n+([\s\S]*?)(?=^#{1,3}\s|$)/gm
  while ((m = sectionRe.exec(md)) !== null) {
    const heading = stripMd(m[2] || '')
    if (!heading || /sınav\s*kart/i.test(heading)) continue
    const para = stripMd(m[3] || '')
      .split(/(?<=[.!?…])\s+/)
      .slice(0, 3)
      .join(' ')
    if (para.length < 40) continue
    cards.push({
      id: `section-${cards.length}`,
      kind: 'section',
      label: 'Not',
      front: heading,
      back: clip(para, 280),
      speech: `${heading}. ${para}`,
    })
  }

  // 4) Quiz → flip cards
  for (const q of input.quiz ?? []) {
    const question = stripMd(q.question || '')
    if (question.length < 8) continue
    let answer = ''
    if (q.type === 'short' && q.correct_text) {
      answer = stripMd(q.correct_text)
    } else if (Array.isArray(q.options) && typeof q.correct_index === 'number') {
      answer = stripMd(q.options[q.correct_index] || '')
    }
    if (!answer) continue
    cards.push({
      id: `quiz-${cards.length}`,
      kind: 'quiz',
      label: 'Quiz',
      front: question,
      back: answer,
      speech: `Soru: ${question}. Cevap: ${answer}.`,
    })
  }

  // Dedupe by front text
  const seen = new Set<string>()
  const unique = cards.filter((c) => {
    const key = c.front.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (unique.length === 0 && md.trim()) {
    unique.push({
      id: 'summary-0',
      kind: 'summary',
      label: 'Özet',
      front: input.title,
      back: clip(stripMd(md), 300),
      speech: `${input.title}. ${stripMd(md).slice(0, 500)}`,
    })
  }

  return unique.slice(0, max)
}

function normalizeAiFlashcards(
  raw: FlashcardItem[] | null | undefined,
  max: number,
): Flashcard[] {
  if (!Array.isArray(raw) || !raw.length) return []
  const out: Flashcard[] = []
  for (const row of raw) {
    const front = stripMd(String(row?.front || ''))
    const back = stripMd(String(row?.back || ''))
    if (front.length < 2 || back.length < 2) continue
    const role =
      normalizeFlashRole(row?.role) ||
      normalizeFlashRole(row?.label) ||
      'teach'
    const meta = FLASH_ROLE_META[role]
    const label =
      String(row?.label || '').trim() || meta.label
    const kind: FlashcardKind =
      role === 'check'
        ? 'quiz'
        : role === 'summary'
          ? 'summary'
          : role === 'concept'
            ? 'concept'
            : 'callout'
    const speech =
      role === 'check'
        ? `Soru: ${front}. Cevap: ${back}.`
        : role === 'teach'
          ? `${front}. ${back}`
          : `${front}. ${back}`
    out.push({
      id: `ai-${out.length}`,
      kind,
      role,
      phase: meta.phase,
      label,
      front: clip(front, role === 'teach' ? 100 : 120),
      back: clip(back, role === 'teach' ? 380 : 320),
      speech,
    })
  }
  out.sort(
    (a, b) =>
      flashRoleSortKey(a.role) - flashRoleSortKey(b.role) ||
      a.id.localeCompare(b.id),
  )
  return out.slice(0, max)
}

function findConceptHint(md: string, concept: string): string | null {
  const plain = md.replace(/\r/g, '')
  const needle = concept.toLowerCase()
  if (needle.length < 2) return null

  // Prefer "X: …" / "X —, …" / "**X** …" definition lines
  const lines = plain.split('\n')
  for (const line of lines) {
    const cleanedLine = stripMd(line)
    const lower = cleanedLine.toLowerCase()
    if (!lower.includes(needle)) continue
    // Definition-ish: concept near start, then explanation
    const at = lower.indexOf(needle)
    if (at <= 24 && cleanedLine.length > concept.length + 18) {
      let rest = cleanedLine.slice(at + concept.length).replace(/^[\s:–—\-–,]+/, '')
      if (rest.length >= 16) return clip(rest, 220)
    }
  }

  const idx = plain.toLowerCase().indexOf(needle)
  if (idx < 0) return null
  // Take the sentence that contains the concept
  const start = Math.max(0, plain.lastIndexOf('.', idx) + 1)
  const endDot = plain.indexOf('.', idx + concept.length)
  const end = endDot > idx ? endDot + 1 : Math.min(plain.length, idx + 260)
  const sentence = stripMd(plain.slice(start, end))
  if (sentence.length < concept.length + 20) return null
  // Don't return a "definition" that is basically just the concept name
  const withoutConcept = sentence
    .replace(new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
    .replace(/\s+/g, ' ')
    .trim()
  if (withoutConcept.length < 16) return null
  return clip(sentence, 220)
}
