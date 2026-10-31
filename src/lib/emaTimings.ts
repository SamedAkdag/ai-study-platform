/** Word-level timeline from EMA Lightning (model frame clock → absolute seconds). */

export type EmaWordTiming = {
  /** Spoken token (normalized piece word) */
  word: string
  /** Absolute start in seconds from audio start */
  start: number
  /** Absolute end in seconds */
  end: number
  /** Index in the full timing list */
  index: number
}

export type EmaTimingTrack = {
  sampleRate: number
  duration: number
  words: EmaWordTiming[]
}

export type EmaPieceTimingEvent = {
  words: string[]
  starts: number[]
  seconds: number
  pause?: number
}

/** Accumulate absolute word timings as EMA fires onPiece for each chunk. */
export function createTimingCollector(sampleRate: number) {
  let offset = 0
  const words: EmaWordTiming[] = []

  return {
    onPiece(info: EmaPieceTimingEvent) {
      const list = info.words || []
      const starts = info.starts || []
      const pieceDur = Math.max(0, Number(info.seconds) || 0)
      const pause = Math.max(0, Number(info.pause) || 0)

      for (let i = 0; i < list.length; i++) {
        const w = String(list[i] || '').trim()
        if (!w) continue
        const localStart = Number(starts[i])
        const start = offset + (Number.isFinite(localStart) ? localStart : 0)
        const nextLocal = Number(starts[i + 1])
        const end =
          offset +
          (Number.isFinite(nextLocal)
            ? nextLocal
            : pieceDur > 0
              ? pieceDur
              : start + 0.12)
        words.push({
          word: w,
          start: roundMs(start),
          end: roundMs(Math.max(end, start + 0.04)),
          index: words.length,
        })
      }

      offset += pieceDur + pause
    },
    /** Prefer total from PCM length when available. */
    finalize(pcmSampleCount?: number): EmaTimingTrack {
      const fromPcm =
        pcmSampleCount && pcmSampleCount > 0
          ? pcmSampleCount / sampleRate
          : 0
      const fromWords = words.length
        ? words[words.length - 1]!.end
        : 0
      const duration = roundMs(Math.max(fromPcm, fromWords, offset))
      if (words.length) {
        const last = words[words.length - 1]!
        if (fromPcm > last.end) {
          words[words.length - 1] = { ...last, end: roundMs(fromPcm) }
        }
      }
      return { sampleRate, duration, words }
    },
  }
}

function roundMs(s: number) {
  return Math.round(s * 1000) / 1000
}

/** Active word index for t (seconds). -1 if before first word. */
export function wordIndexAtTime(
  words: EmaWordTiming[],
  t: number,
): number {
  if (!words.length) return -1
  if (t < words[0]!.start) return -1
  // Binary search: last word with start <= t
  let lo = 0
  let hi = words.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid]!.start <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export function timingsToJson(track: EmaTimingTrack): string {
  return `${JSON.stringify(track, null, 2)}\n`
}
