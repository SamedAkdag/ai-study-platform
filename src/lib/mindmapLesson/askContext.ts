import type { LessonTimeline } from '@/lib/mindmapLesson/types'

export type LessonAskContext = {
  selectedText: string
  precedingContext: string
  followingContext: string
  selectionQuote: string
  segmentTitle: string
}

function clip(s: string, max: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trim()}…`
}

/**
 * Compact tutor context for interrupt Q&A.
 * Keep prompts small so the LLM answers faster (TTS-safe lecture path).
 */
export function buildLessonAskContext(
  timeline: LessonTimeline | null,
  segmentIndex: number,
  _markdown?: string | null,
): LessonAskContext | null {
  if (!timeline?.segments.length) return null
  const i = Math.max(0, Math.min(segmentIndex, timeline.segments.length - 1))
  const seg = timeline.segments[i]
  if (!seg) return null

  // One neighbor each side, clipped — enough grounding, less prompt latency
  const selectedText = clip(
    [seg.title, seg.text].filter(Boolean).join('. '),
    720,
  )
  const preceding = timeline.segments
    .slice(Math.max(0, i - 1), i)
    .map((s) => `${s.title}: ${s.text}`)
    .join(' ')
  const following = timeline.segments
    .slice(i + 1, i + 2)
    .map((s) => `${s.title}: ${s.text}`)
    .join(' ')

  return {
    selectedText,
    precedingContext: clip(preceding, 520),
    followingContext: clip(following, 420),
    selectionQuote: clip(`${seg.title} — ${seg.text}`, 280),
    segmentTitle: seg.title || 'Anlatım',
  }
}
