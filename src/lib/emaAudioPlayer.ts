/** EMA model sample rate (Hz). */
export const EMA_SOURCE_RATE = 48000

function isMobileUa() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/** Linear resample 48 kHz EMA PCM → AudioContext rate (fixes mobile crackle). */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!input.length) return input
  if (Math.abs(fromRate - toRate) < 1) return input
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const j = Math.floor(src)
    const f = src - j
    const a = input[j] ?? 0
    const b = input[Math.min(j + 1, input.length - 1)] ?? a
    out[i] = a + (b - a) * f
  }
  return out
}

/** Tiny edge fades remove clicks between streamed windows. */
function applyEdgeFade(samples: Float32Array, fade = 96) {
  const n = Math.min(fade, Math.floor(samples.length / 4))
  if (n < 2) return samples
  const out = samples.slice()
  for (let i = 0; i < n; i++) {
    const g = i / n
    out[i]! *= g
    out[out.length - 1 - i]! *= g
  }
  return out
}

export type EmaChunkPlayer = {
  ctx: AudioContext
  resume: () => Promise<void>
  play: (samples: Float32Array) => void
  currentTime: () => number
  queuedUntil: () => number
  suspend: () => Promise<void>
  resumePlayback: () => Promise<void>
  stop: () => void
}

/**
 * Mobile-safe streaming player for EMA 48 kHz mono PCM.
 * Always builds buffers at ctx.sampleRate (never lie about 48k on a 44.1k context).
 */
export function createEmaChunkPlayer(sourceRate = EMA_SOURCE_RATE): EmaChunkPlayer {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  // Don't force 48000 — mobile often ignores it and then plays wrong-rate buffers.
  const ctx = new Ctx()
  const mobile = isMobileUa()
  const lookahead = mobile ? 0.12 : 0.03
  let next = 0
  let origin: number | null = null
  let stopped = false

  return {
    ctx,
    async resume() {
      if (ctx.state === 'suspended') await ctx.resume()
    },
    play(samples: Float32Array) {
      if (stopped || !samples.length) return
      const faded = applyEdgeFade(
        samples instanceof Float32Array ? samples : new Float32Array(samples),
      )
      const pcm = resampleLinear(faded, sourceRate, ctx.sampleRate)
      const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate)
      buffer.copyToChannel(pcm, 0)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      const t = Math.max(ctx.currentTime + lookahead, next)
      if (origin == null) origin = t
      src.start(t)
      next = t + buffer.duration
    },
    currentTime() {
      if (origin == null) return 0
      return Math.max(0, ctx.currentTime - origin)
    },
    queuedUntil() {
      return next
    },
    async suspend() {
      if (ctx.state === 'running') await ctx.suspend()
    },
    async resumePlayback() {
      if (ctx.state === 'suspended') await ctx.resume()
    },
    stop() {
      stopped = true
      void ctx.close().catch(() => {})
    },
  }
}
