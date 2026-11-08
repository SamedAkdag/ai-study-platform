/**
 * Output quality gates for Studium generation.
 * Score 0–100; ok ≈ usable for students.
 */

import type { MindMap } from './mindMapGen.ts'
import {
  isSentenceFragmentLabel,
  isWeakTopicLabel,
  toMindMapNodeLabel,
  toTopicLabel,
} from './mindMapGen.ts'

export type QualityReport = {
  kind: string
  score: number
  ok: boolean
  issues: string[]
}

export type QuizItem = {
  question: string
  options: string[]
  correct_index: number
  explanation: string
}

export type ExampleItem = {
  problem: string
  solution_steps: string[]
}

const SENTENCE_RE =
  /\b(dır|dir|tır|tir|çünkü|olan|için|edin|edilir|görülür|anlamına)\b/i
const TEMPLATE_H2 =
  /^(neden önemli|günlük hayattan|adım adım|sık yapılan|anahtar noktalar|özet|sınav kartı)\??$/i

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function scoreNotesMarkdown(
  markdown: string,
  pageNums: number[] = [],
): QualityReport {
  const issues: string[] = []
  let score = 55
  const md = String(markdown || '').trim()
  if (md.length < 180) {
    issues.push('not_too_short')
    score -= 25
  } else {
    score += 10
  }
  // Prefer real lesson length (staged Anlatım); don’t reward skim.
  if (md.length >= 4500) score += 12
  else if (md.length >= 2800) score += 8
  else if (md.length >= 1200) score += 4
  else if (md.length > 120 && md.length < 900) {
    issues.push('thin_notes')
    score -= 8
  }

  const h2 = (md.match(/^##\s+/gm) || []).length
  if (h2 >= 5) score += 12
  else if (h2 >= 3) score += 10
  else issues.push('few_headings')

  if (/\|.+\|/.test(md)) score += 8
  else issues.push('no_table')

  if (/>\s*\*\*/.test(md)) score += 5

  // Penalize if ONLY template shells with no page grounding
  const onlyTemplates =
    h2 > 0 &&
    [...md.matchAll(/^##\s+(.+)$/gm)].every((m) =>
      TEMPLATE_H2.test(String(m[1] || '').trim()),
    )
  if (onlyTemplates) {
    issues.push('template_only_headings')
    score -= 15
  }

  if (pageNums.length >= 2) {
    const joined = pageNums.join('|')
    if (new RegExp(`s\\.\\s*(${joined})`).test(md) || md.includes('PAGE')) {
      score += 5
    }
  }

  score = clampScore(score)
  return { kind: 'notes', score, ok: score >= 45 && md.length >= 120, issues }
}

export function validateAndCleanQuiz(raw: unknown): {
  quiz: QuizItem[]
  report: QualityReport
} {
  const issues: string[] = []
  const quiz: QuizItem[] = []
  if (!Array.isArray(raw)) {
    return {
      quiz: [],
      report: {
        kind: 'quiz',
        score: 0,
        ok: false,
        issues: ['not_array'],
      },
    }
  }

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const question = String(r.question || '').trim().slice(0, 320)
    const options = Array.isArray(r.options)
      ? r.options.map((o) => String(o || '').trim().slice(0, 160)).filter(Boolean)
      : []
    const correct = Number(r.correct_index)
    const explanation = String(r.explanation || '').trim().slice(0, 420)
    if (question.length < 8) {
      issues.push('short_question')
      continue
    }
    if (options.length < 3) {
      issues.push('few_options')
      continue
    }
    while (options.length < 4) options.push('—')
    const opts = options.slice(0, 4)
    if (!Number.isFinite(correct) || correct < 0 || correct > 3) {
      issues.push('bad_correct_index')
      continue
    }
    if (explanation.length < 8) {
      issues.push('weak_explanation')
    }
    // Reject identical options
    const uniq = new Set(opts.map((o) => o.toLowerCase()))
    if (uniq.size < 3) {
      issues.push('duplicate_options')
      continue
    }
    quiz.push({
      question,
      options: opts,
      correct_index: Math.round(correct),
      explanation: explanation || 'Doğru şık kaynak notuna dayanır.',
    })
    if (quiz.length >= 6) break
  }

  let score = quiz.length * 18
  if (quiz.length >= 3) score += 15
  if (quiz.length >= 4) score += 10
  if (issues.includes('weak_explanation')) score -= 8
  score = clampScore(score)

  return {
    quiz,
    report: {
      kind: 'quiz',
      score,
      ok: quiz.length >= 2,
      issues: [...new Set(issues)].slice(0, 8),
    },
  }
}

export function validateAndCleanExamples(raw: unknown): {
  examples: ExampleItem[]
  report: QualityReport
} {
  const issues: string[] = []
  const examples: ExampleItem[] = []
  if (!Array.isArray(raw)) {
    return {
      examples: [],
      report: {
        kind: 'examples',
        score: 0,
        ok: false,
        issues: ['not_array'],
      },
    }
  }
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const problem = String(r.problem || '').trim().slice(0, 400)
    const steps = Array.isArray(r.solution_steps)
      ? r.solution_steps
          .map((s) => String(s || '').trim().slice(0, 220))
          .filter((s) => s.length >= 3)
          .slice(0, 8)
      : []
    if (problem.length < 10 || steps.length < 2) {
      issues.push('weak_example')
      continue
    }
    examples.push({ problem, solution_steps: steps })
    if (examples.length >= 4) break
  }
  const score = clampScore(examples.length * 35)
  return {
    examples,
    report: {
      kind: 'examples',
      score,
      ok: examples.length >= 1,
      issues: [...new Set(issues)].slice(0, 6),
    },
  }
}

/** Keep only complete noun-phrase titles — drop half-sentences / definition scraps. */
export function scrubMindMapLabels(map: MindMap): MindMap {
  const branches = map.branches
    .map((b) => {
      let label = toMindMapNodeLabel(b.label)
      const children = (b.children ?? [])
        .map((c) => toMindMapNodeLabel(c))
        .filter((c) => {
          if (!c) return false
          if (isWeakTopicLabel(c) || isSentenceFragmentLabel(c)) return false
          if (SENTENCE_RE.test(c)) return false
          if (c.length > 52) return false
          return true
        })
        .slice(0, 6)
      if (!label || isWeakTopicLabel(label) || isSentenceFragmentLabel(label)) {
        const promoted = children.find(
          (c) => !isWeakTopicLabel(c) && !isSentenceFragmentLabel(c),
        )
        if (!promoted) return null
        label = promoted
      }
      return {
        ...b,
        label,
        children: children.filter(
          (c) => c.toLowerCase() !== label!.toLowerCase(),
        ),
        ...(b.page ? { page: b.page } : {}),
        // Narration is spoken prose — OK. Never use narration as the visible label.
        ...(b.narration ? { narration: b.narration } : {}),
        ...(b.child_narrations?.length
          ? { child_narrations: b.child_narrations.slice(0, children.length) }
          : {}),
      }
    })
    .filter((b): b is NonNullable<typeof b> => !!b && !!b.label)
  const central =
    toMindMapNodeLabel(map.central) ||
    toTopicLabel(map.central, 5, 40) ||
    map.central
  return {
    central,
    ...(map.narration ? { narration: map.narration } : {}),
    branches,
  }
}

export function scoreMindMap(
  map: MindMap | null,
  atlasPages: number[] = [],
): QualityReport {
  const issues: string[] = []
  if (!map || !map.branches?.length) {
    return {
      kind: 'mind_map',
      score: 0,
      ok: false,
      issues: ['empty'],
    }
  }
  let score = 20
  const n = map.branches.length
  score += Math.min(30, n * 3)

  let filled = 0
  let sentenceKids = 0
  let totalKids = 0
  let weakLabels = 0
  for (const b of map.branches) {
    if (isWeakTopicLabel(b.label)) weakLabels += 1
    const kids = b.children ?? []
    totalKids += kids.length
    if (kids.length >= 2) filled += 1
    for (const c of kids) {
      if (isWeakTopicLabel(c)) weakLabels += 1
      if (SENTENCE_RE.test(c) || c.split(/\s+/).length > 8) sentenceKids += 1
    }
  }
  if (weakLabels > 0) {
    issues.push('weak_topic_labels')
    score -= Math.min(40, weakLabels * 10)
  }
  score += Math.min(25, filled * 4)
  if (totalKids === 0) {
    issues.push('no_children')
    score -= 20
  }
  if (sentenceKids > 0) {
    issues.push('sentence_children')
    score -= Math.min(25, sentenceKids * 4)
  }
  if (n < 4) issues.push('few_branches')
  if (filled < Math.max(2, Math.floor(n / 2))) issues.push('sparse_children')

  if (atlasPages.length >= 3) {
    const pages = new Set(
      map.branches.map((b) => b.page).filter((p): p is number => !!p && p >= 1),
    )
    const coverage = pages.size / Math.min(atlasPages.length, 12)
    score += Math.round(coverage * 15)
    if (coverage < 0.35) issues.push('weak_page_coverage')
  }

  score = clampScore(score)
  return {
    kind: 'mind_map',
    score,
    ok: score >= 50 && n >= 3 && filled >= 1,
    issues,
  }
}

export function scorePracticeBundle(input: {
  quiz: QuizItem[]
  examples: ExampleItem[]
  flashCount: number
}): QualityReport {
  const issues: string[] = []
  let score = 10
  score += Math.min(40, input.quiz.length * 10)
  score += Math.min(25, input.examples.length * 12)
  score += Math.min(25, input.flashCount * 3)
  if (input.quiz.length < 2) issues.push('few_quiz')
  if (input.examples.length < 1) issues.push('no_examples')
  if (input.flashCount < 4) issues.push('few_flash')
  score = clampScore(score)
  return {
    kind: 'practice',
    score,
    ok: score >= 40 && input.quiz.length + input.examples.length > 0,
    issues,
  }
}
