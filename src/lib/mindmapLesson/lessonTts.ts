/**
 * Build a unified lesson timeline with EMA (client-only, no new server calls).
 * Synthesizes only a small lookahead ahead of the playhead so the UI stays responsive.
 * Optional IndexedDB cache skips re-synth for the same chapter script.
 */
import { synthesizeEmaWav, ensureEma, type EmaLoadProgress } from '@/lib/emaEngine'
import {
  getCachedSegment,
  putCachedSegment,
} from '@/lib/mindmapLesson/wavCache'
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

/** Keep several WAVs ready ahead of the playhead to avoid silence gaps. */
const DEFAULT_LOOKAHEAD = 4

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function yieldToUi() {
  await sleep(0)
}

/**
 * Synthesize each step with backpressure: never run more than `lookahead`
 * segments ahead of the current playhead. Playback can start after the first
 * segment while the rest are produced lazily.
 */
export async function synthesizeLessonTimeline(
  steps: LessonStep[],
  opts: {
    signal?: AbortSignal
    speed?: number
    /** IndexedDB cache namespace (chapter + script hash) */
    cacheKey?: string | null
    /** How many segments to keep ready ahead of playhead (default 2) */
    lookahead?: number
    /** Current playing segment index (live) */
    getPlayheadIndex?: () => number
    /** Pause synth during ask interrupt etc. */
    shouldPause?: () => boolean
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
  const lookahead = Math.max(1, opts.lookahead ?? DEFAULT_LOOKAHEAD)
  const speed = opts.speed ?? 1
  const cacheKey = opts.cacheKey || null

  async function waitIfBuffered() {
    while (
      !opts.signal?.aborted &&
      segments.length > 0 &&
      segments.length > (opts.getPlayheadIndex?.() ?? 0) + lookahead
    ) {
      while (opts.shouldPause?.()) {
        await sleep(120)
        if (opts.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
      }
      await sleep(140)
    }
  }

  async function waitIfPaused() {
    while (opts.shouldPause?.()) {
      await sleep(100)
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
    }
  }

  let consecutiveFails = 0

  for (let i = 0; i < steps.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await waitIfPaused()
    await waitIfBuffered()
    await waitIfPaused()

    const step = steps[i]!
    opts.onProgress?.({
      phase: 'segment',
      label: `Ses: ${step.title}`,
      index: i + 1,
      total: steps.length,
      readyCount: segments.length,
    })

    try {
      let blob: Blob
      let timings: {
        duration: number
        words: Array<{ word: string; start: number; end: number }>
      }

      const cached =
        cacheKey ? await getCachedSegment(cacheKey, step.id) : null
      if (cached) {
        blob = cached.blob
        timings = cached.timings
      } else {
        const result = await synthesizeEmaWav(step.text, {
          play: false,
          speed,
          signal: opts.signal,
          shouldPause: opts.shouldPause,
        })
        blob = result.blob
        timings = result.timings
        if (cacheKey) {
          void putCachedSegment(cacheKey, step.id, blob, result.timings)
        }
      }
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const start = cursor
      const dur = Math.max(
        timings.duration,
        timings.words.at(-1)?.end ?? 0.4,
      )
      const end = start + dur
      for (const w of timings.words) {
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
        blob,
      })
      cursor = end + gap
      consecutiveFails = 0
      opts.onPartial?.({
        totalDuration: cursor,
        words: [...words],
        segments: [...segments],
      })
      await yieldToUi()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err
      consecutiveFails += 1
      console.warn('[lessonTts] segment skipped', step.id, err)
      if (consecutiveFails >= 3) {
        if (segments.length) break
        throw err
      }
      await yieldToUi()
    }
  }

  return {
    totalDuration: cursor,
    words,
    segments,
  }
}
