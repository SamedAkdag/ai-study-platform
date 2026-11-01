import type {
  LessonCamera,
  LessonSegment,
  LessonTimeline,
  LessonWord,
} from '@/lib/mindmapLesson/types'
import { wordIndexAtTime, type EmaWordTiming } from '@/lib/emaTimings'

export type LessonPlayerState = {
  playing: boolean
  currentTime: number
  segmentIndex: number
  wordIndex: number
  nodeId: string | null
  camera: LessonCamera
  rate: number
  done: boolean
}

/**
 * Sequential HTMLAudio segment player with a single rAF clock.
 */
export function createLessonPlayer() {
  const audio = new Audio()
  audio.preload = 'auto'

  let rate = 1
  let segIndex = 0
  let playing = false
  let raf = 0
  let objectUrl: string | null = null
  let baseOffset = 0
  let listeners: Array<(s: LessonPlayerState) => void> = []
  let unlocked = false
  let segments: LessonSegment[] = []
  let words: LessonWord[] = []
  let totalDuration = 0
  let synthDone = false
  function wordsAsEma(): EmaWordTiming[] {
    return words.map((w, i) => ({
      word: w.w,
      start: w.s,
      end: w.e,
      index: i,
    }))
  }

  function buildState(): LessonPlayerState {
    const t = currentTime()
    // Trust the loaded segment index — avoids flicker between absolute-time lookups
    const useSi = Math.max(0, Math.min(segments.length - 1, segIndex))
    const seg = segments[useSi]
    const wi = wordIndexAtTime(wordsAsEma(), t)
    const atEnd =
      synthDone &&
      segments.length > 0 &&
      !playing &&
      t >= Math.max(0, totalDuration - 0.4)
    return {
      playing,
      currentTime: t,
      segmentIndex: useSi,
      wordIndex: wi,
      nodeId: seg?.nodeId ?? null,
      camera: seg?.camera ?? 'hub',
      rate,
      done: atEnd,
    }
  }

  function emit() {
    const state = buildState()
    for (const fn of listeners) fn(state)
  }

  function currentTime() {
    if (!segments.length) return 0
    return baseOffset + (audio.currentTime || 0)
  }

  function clearUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = null
    }
  }

  async function loadSegment(i: number, autoplay: boolean) {
    const seg = segments[i]
    if (!seg) return
    segIndex = i
    baseOffset = seg.start
    clearUrl()
    objectUrl = URL.createObjectURL(seg.blob)
    audio.src = objectUrl
    audio.playbackRate = rate
    audio.load()
    // Announce focus immediately (map sync) before audio starts
    emit()
    if (autoplay) {
      playing = true
      try {
        await audio.play()
      } catch {
        playing = false
      }
      loop()
    }
    emit()
  }

  function loop() {
    cancelAnimationFrame(raf)
    let lastTick = 0
    const tick = (now: number) => {
      // ~10 fps UI clock — karaoke + map focus without React thrash
      if (now - lastTick >= 100) {
        lastTick = now
        emit()
      }
      if (playing) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }

  audio.onended = () => {
    const next = segIndex + 1
    if (next < segments.length) {
      void loadSegment(next, true)
      return
    }
    if (!synthDone) {
      playing = false
      emit()
      const wait = window.setInterval(() => {
        if (segIndex + 1 < segments.length) {
          window.clearInterval(wait)
          playing = true
          void loadSegment(segIndex + 1, true)
        } else if (synthDone) {
          window.clearInterval(wait)
          playing = false
          emit()
        }
      }, 120)
      return
    }
    playing = false
    emit()
  }

  return {
    async unlock() {
      if (unlocked) return
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        const ctx = new Ctx()
        const buf = ctx.createBuffer(1, 1, 22050)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start(0)
        await ctx.resume()
        void ctx.close()
        unlocked = true
      } catch {
        /* ignore */
      }
    },
    subscribe(fn: (s: LessonPlayerState) => void) {
      listeners.push(fn)
      fn(buildState())
      return () => {
        listeners = listeners.filter((x) => x !== fn)
      }
    },
    setTimeline(tl: LessonTimeline, opts?: { markDone?: boolean }) {
      segments = tl.segments
      words = tl.words
      totalDuration = tl.totalDuration
      if (opts?.markDone) synthDone = true
      emit()
    },
    markSynthDone() {
      synthDone = true
      emit()
    },
    async play() {
      if (!segments.length) return
      if (!audio.src) await loadSegment(segIndex, true)
      else {
        playing = true
        try {
          await audio.play()
        } catch {
          playing = false
        }
        loop()
        emit()
      }
    },
    pause() {
      playing = false
      audio.pause()
      cancelAnimationFrame(raf)
      emit()
    },
    setRate(r: number) {
      rate = Math.min(1.5, Math.max(0.75, r))
      audio.playbackRate = rate
      emit()
    },
    async seekSegment(i: number) {
      const idx = Math.max(0, Math.min(segments.length - 1, i))
      const was = playing
      await loadSegment(idx, was)
    },
    async seekNode(nodeId: string) {
      const i = segments.findIndex((s) => s.nodeId === nodeId)
      if (i >= 0) await this.seekSegment(i)
    },
    async next() {
      await this.seekSegment(segIndex + 1)
      if (playing) await this.play()
    },
    async prev() {
      await this.seekSegment(segIndex - 1)
      if (playing) await this.play()
    },
    getState(): LessonPlayerState {
      return buildState()
    },
    getTimelineSnapshot(): LessonTimeline {
      return { totalDuration, words: [...words], segments: [...segments] }
    },
    destroy() {
      playing = false
      audio.pause()
      cancelAnimationFrame(raf)
      clearUrl()
      listeners = []
      segments = []
      words = []
    },
  }
}

export type LessonPlayerApi = ReturnType<typeof createLessonPlayer>
