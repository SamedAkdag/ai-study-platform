/**
 * Browser EMA Lightning TTS — same fast path as the first integration:
 * WebGPU + fp32, stream audio to speakers as soon as each chunk is ready.
 * Word timings are collected on the side (onPiece) without changing the synth loop.
 */
import { EMA, wavBlob, RATE } from '@/lib/ema/tts.js'
import {
  createEmaChunkPlayer,
  type EmaChunkPlayer,
} from '@/lib/emaAudioPlayer'
import {
  createTimingCollector,
  timingsToJson,
  type EmaTimingTrack,
} from '@/lib/emaTimings'

export type { EmaTimingTrack, EmaWordTiming } from '@/lib/emaTimings'
export { timingsToJson, wordIndexAtTime } from '@/lib/emaTimings'

export const EMA_MODEL_BASE =
  'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/'

export { RATE, wavBlob }

export const EMA_SOFT_CHAR_LIMIT = 2200

export type EmaLoadProgress = {
  stage: string
  fraction: number
  label: string
}

export type EmaSynthProgress = {
  phase: 'loading' | 'synthesizing'
  label: string
  piece?: number
}

export type SynthResult = {
  blob: Blob
  chunks: Float32Array[]
  sampleRate: number
  timings: EmaTimingTrack
  timingsJson: string
}

type EnsureOpts = {
  onProgress?: (p: EmaLoadProgress) => void
  forceBackend?: 'webgpu' | 'wasm'
}

let instance: InstanceType<typeof EMA> | null = null
let loadPromise: Promise<InstanceType<typeof EMA>> | null = null
let lastBackend: 'webgpu' | 'wasm' | null = null

function stageLabel(stage: string): string {
  switch (stage) {
    case 'normalizer':
      return 'Normalizer hazırlanıyor…'
    case 'text':
      return 'Metin modeli…'
    case 'sound':
      return 'Ses modeli…'
    case 'decoder':
      return 'Decoder…'
    default:
      return 'Ses modeli hazırlanıyor…'
  }
}

function preferWasmOnly(): boolean {
  if (typeof navigator === 'undefined') return true
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return true
  return typeof (navigator as Navigator & { gpu?: unknown }).gpu === 'undefined'
}

async function loadBackend(
  backend: 'webgpu' | 'wasm',
  opts: EnsureOpts,
): Promise<InstanceType<typeof EMA>> {
  return EMA.load(
    backend,
    EMA_MODEL_BASE,
    (stage, fraction) => {
      opts.onProgress?.({
        stage,
        fraction,
        label: stageLabel(stage),
      })
    },
    'fp32',
  )
}

export async function resetEma() {
  const prev = instance
  instance = null
  loadPromise = null
  lastBackend = null
  if (prev) await prev.release().catch(() => {})
}

/** WebGPU first (original fast path), WASM only if needed. */
export async function ensureEma(
  opts: EnsureOpts = {},
): Promise<InstanceType<typeof EMA>> {
  if (instance) return instance
  if (loadPromise) return loadPromise

  const forced = opts.forceBackend
  const tryGpu = forced === 'webgpu' || (!forced && !preferWasmOnly())

  loadPromise = (async () => {
    if (tryGpu) {
      try {
        instance = await loadBackend('webgpu', opts)
        lastBackend = 'webgpu'
        return instance
      } catch {
        /* fall through */
      }
    }
    instance = await loadBackend('wasm', opts)
    lastBackend = 'wasm'
    return instance
  })()

  try {
    return await loadPromise
  } catch (err) {
    loadPromise = null
    instance = null
    lastBackend = null
    throw err
  }
}

export function getEmaBackend(): 'webgpu' | 'wasm' | null {
  return lastBackend
}

export function isEmaReady(): boolean {
  return !!instance
}

function isGpuInferenceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '')
  return /OrtRun|shader_helper|requires f16|shader-f16|WebGPU|Cast node|Non-zero status/i.test(
    msg,
  )
}

export function softTrimForEma(
  text: string,
  limit = EMA_SOFT_CHAR_LIMIT,
): { text: string; truncated: boolean } {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= limit) return { text: t, truncated: false }
  const slice = t.slice(0, limit)
  const cut = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('; '),
  )
  const body = (cut > limit * 0.5 ? slice.slice(0, cut + 1) : slice).trim()
  return { text: body, truncated: true }
}

export { createEmaChunkPlayer }

async function runStream(
  tts: InstanceType<typeof EMA>,
  text: string,
  opts: {
    speed?: number
    seed?: number
    signal?: AbortSignal
    play?: boolean
    shouldPause?: () => boolean
    onPlayer?: (player: EmaChunkPlayer) => void
    onSynthProgress?: (p: EmaSynthProgress) => void
    onTimings?: (t: EmaTimingTrack) => void
    onClock?: (seconds: number) => void
  },
): Promise<SynthResult> {
  const collector = createTimingCollector(RATE)
  const chunks: Float32Array[] = []
  let pcm = 0
  let piece = 0

  const player = opts.play !== false ? createEmaChunkPlayer(RATE) : null
  if (player) {
    await player.resume()
    opts.onPlayer?.(player)
  }

  let clockRaf = 0
  const tickClock = () => {
    if (!player) return
    opts.onClock?.(player.currentTime())
    clockRaf = requestAnimationFrame(tickClock)
  }
  if (player && opts.onClock) clockRaf = requestAnimationFrame(tickClock)

  opts.onSynthProgress?.({
    phase: 'synthesizing',
    label: 'Ses üretiliyor…',
  })

  try {
    for await (const audio of tts.stream(text, {
      speed: opts.speed ?? 1,
      seed: opts.seed ?? 0,
      onPiece: (info) => {
        piece += 1
        collector.onPiece(info)
        opts.onTimings?.(collector.finalize(pcm || 1))
        opts.onSynthProgress?.({
          phase: 'synthesizing',
          label: `Ses üretiliyor… (${piece})`,
          piece,
        })
      },
    })) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      while (opts.shouldPause?.()) {
        await new Promise((r) => setTimeout(r, 80))
        if (opts.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
      }
      chunks.push(audio)
      pcm += audio.length
      player?.play(audio)
    }
  } catch (err) {
    player?.stop()
    if (clockRaf) cancelAnimationFrame(clockRaf)
    throw err
  }

  if (clockRaf) cancelAnimationFrame(clockRaf)
  if (player) {
    const remainingMs = Math.max(
      0,
      (player.queuedUntil() - player.ctx.currentTime + 0.35) * 1000,
    )
    window.setTimeout(() => player.stop(), Math.ceil(remainingMs))
  }

  if (!chunks.length || pcm < 100) {
    throw new Error('Ses üretilemedi — metin model tarafından boşaldı olabilir')
  }

  const timings = collector.finalize(pcm)
  opts.onTimings?.(timings)

  return {
    blob: wavBlob(chunks),
    chunks,
    sampleRate: RATE,
    timings,
    timingsJson: timingsToJson(timings),
  }
}

export async function synthesizeEmaWav(
  text: string,
  opts: {
    speed?: number
    seed?: number
    signal?: AbortSignal
    onProgress?: (p: EmaLoadProgress) => void
    onSynthProgress?: (p: EmaSynthProgress) => void
    onTimings?: (t: EmaTimingTrack) => void
    onClock?: (seconds: number) => void
    shouldPause?: () => boolean
    onPlayer?: (player: EmaChunkPlayer) => void
    /** Default true — play while generating (original fast feel). */
    play?: boolean
  } = {},
): Promise<SynthResult> {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim()
  if (trimmed.length < 2) throw new Error('Okunacak metin yok')

  let tts = await ensureEma({ onProgress: opts.onProgress })
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  try {
    return await runStream(tts, trimmed, opts)
  } catch (err) {
    if (
      opts.signal?.aborted ||
      (err as DOMException)?.name === 'AbortError'
    ) {
      throw err
    }
    if (lastBackend !== 'webgpu' || !isGpuInferenceError(err)) throw err

    await resetEma()
    tts = await ensureEma({
      onProgress: opts.onProgress,
      forceBackend: 'wasm',
    })
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    opts.onSynthProgress?.({
      phase: 'synthesizing',
      label: 'Ses üretiliyor (CPU)…',
    })
    return runStream(tts, trimmed, opts)
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function safeDownloadName(title: string, ext = 'wav') {
  const base =
    title
      .replace(/[^\w\u00C0-\u024f\s-]+/gi, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'ders'
  return `${base}.${ext}`
}
