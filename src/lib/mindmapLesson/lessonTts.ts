/**
 * Build a unified lesson timeline with EMA (client-only, no new server calls).
 */
import { synthesizeEmaWav, ensureEma, type EmaLoadProgress } from '@/lib/emaEngine'
import type {
  LessonSegment,
  LessonStep,
  LessonTimeline,
  LessonWord,
} from '@/lib/mindmapLesson/types'

export type LessonSynthProgress = {
  phase: 'model' | 'segment'
  label: string
  index: number
  total: number
  /** First segments ready — UI may start playback */
  readyCount: number
}

/**
 * Synthesize each step; return a growing timeline.
 * Calls onReady(partial) after each finished segment so playback can start early.
 */
export async function synthesizeLessonTimeline(
  steps: LessonStep[],
  opts: {
    signal?: AbortSignal
    speed?: number
    onProgress?: (p: LessonSynthProgress) => void
    onModelProgress?: (p: EmaLoadProgress) => void
    onPartial?: (timeline: LessonTimeline) => void
  } = {},
): Promise<LessonTimeline> {
  await ensureEma({ onProgress: opts.onModelProgress })
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const segments: LessonSegment[] = []
  const words: LessonWord[] = []
  let cursor = 0
  const gap = 0.18

  for (let i = 0; i < steps.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const step = steps[i]!
    opts.onProgress?.({
      phase: 'segment',
      label: `Ses: ${step.title}`,
      index: i + 1,
      total: steps.length,
      readyCount: segments.length,
    })

    try {
      const result = await synthesizeEmaWav(step.text, {
        play: false,
        speed: opts.speed ?? 1,
        signal: opts.signal,
      })
      const start = cursor
      const dur = Math.max(
        result.timings.duration,
        result.timings.words.at(-1)?.end ?? 0.4,
      )
      const end = start + dur
      for (const w of result.timings.words) {
        words.push({
          w: w.word,
          s: start + w.start,
          e: start + w.end,
          segmentId: step.id,
        })
      }
      segments.push({
        id: step.id,
        nodeId: step.nodeId,
        type: step.type,
        text: step.text,
        title: step.title,
        camera: step.camera,
        start,
        end,
        blob: result.blob,
      })
      cursor = end + gap
      opts.onPartial?.({
        totalDuration: cursor,
        words: [...words],
        segments: [...segments],
      })
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err
      // Skip failed segment; keep going
      console.warn('[lessonTts] segment skipped', step.id, err)
    }
  }

  return {
    totalDuration: cursor,
    words,
    segments,
  }
}
