/**
 * Browser-only Turkish TTS via EMA Lightning ONNX (Apache-2.0).
 * Weights load from Hugging Face with CORS + Cache Storage — nothing is sent to our servers.
 *
 * Backend note: WebGPU path is opt-in only. Many GPUs fail at OrtRun with
 * "Cast … requires f16" even on fp32 graphs; WASM is the reliable default.
 */
import { EMA, wavBlob, RATE } from '@/lib/ema/tts.js'
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

export type EmaLoadProgress = {
  stage: string
  fraction: number
  label: string
}

export type EmaSynthProgress = {
  phase: 'loading' | 'synthesizing'
  label: string
  piece?: number
  pieces?: number
}

type EnsureOpts = {
  onProgress?: (p: EmaLoadProgress) => void
  precision?: 'fp16' | 'fp32'
  /** Default is wasm (stable). Pass webgpu only for experiments. */
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

async function loadBackend(
  backend: 'webgpu' | 'wasm',
  opts: EnsureOpts,
): Promise<InstanceType<typeof EMA>> {
  const precision = opts.precision ?? 'fp32'
  const ema = await EMA.load(
    backend,
    EMA_MODEL_BASE,
    (stage, fraction) => {
      opts.onProgress?.({
        stage,
        fraction,
        label: stageLabel(stage),
      })
    },
    precision,
  )
  return ema
}

export async function resetEma() {
  const prev = instance
  instance = null
  loadPromise = null
  lastBackend = null
  if (prev) await prev.release().catch(() => {})
}

/** Singleton load — WASM by default (WebGPU often breaks without shader-f16). */
export async function ensureEma(
  opts: EnsureOpts = {},
): Promise<InstanceType<typeof EMA>> {
  if (instance) return instance
  if (loadPromise) return loadPromise

  const backend: 'webgpu' | 'wasm' =
    opts.forceBackend === 'webgpu' ? 'webgpu' : 'wasm'

  loadPromise = (async () => {
    try {
      instance = await loadBackend(backend, {
        ...opts,
        precision: opts.precision ?? 'fp32',
      })
      lastBackend = backend
      return instance
    } catch (err) {
      if (backend === 'webgpu') {
        instance = await loadBackend('wasm', {
          ...opts,
          precision: 'fp32',
        })
        lastBackend = 'wasm'
        return instance
      }
      throw err
    }
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

function isRecoverableInferenceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '')
  return /OrtRun|shader_helper|requires f16|shader-f16|WebGPU|Cast node|Non-zero status|Failed to run|EXIT|wasm/i.test(
    msg,
  )
}

/** Schedule Float32 chunks on an AudioContext for gapless-ish streaming play. */
export function createChunkPlayer(sampleRate = RATE) {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  const ctx = new Ctx({ sampleRate })
  let next = 0
  let stopped = false

  return {
    ctx,
    async resume() {
      if (ctx.state === 'suspended') await ctx.resume()
    },
    play(samples: Float32Array) {
      if (stopped || !samples.length) return
      const copy =
        samples instanceof Float32Array ? samples : new Float32Array(samples)
      const buffer = ctx.createBuffer(1, copy.length, sampleRate)
      buffer.copyToChannel(copy, 0)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      const t = Math.max(ctx.currentTime, next)
      src.start(t)
      next = t + buffer.duration
    },
    stop() {
      stopped = true
      void ctx.close().catch(() => {})
    },
  }
}

export type SynthResult = {
  blob: Blob
  chunks: Float32Array[]
  sampleRate: number
  timings: EmaTimingTrack
  timingsJson: string
}

async function runStream(
  tts: InstanceType<typeof EMA>,
  text: string,
  opts: {
    speed?: number
    seed?: number
    signal?: AbortSignal
    onChunk?: (chunk: Float32Array, index: number) => void
    onSynthProgress?: (p: EmaSynthProgress) => void
    play?: boolean
  },
): Promise<SynthResult> {
  const player = opts.play ? createChunkPlayer(RATE) : null
  if (player) await player.resume()

  const collector = createTimingCollector(RATE)
  const chunks: Float32Array[] = []
  let i = 0
  let pcm = 0
  let piece = 0
  const pieceTotal = (() => {
    try {
      return tts.pieces(text, opts.speed ?? 1).length
    } catch {
      return 0
    }
  })()

  try {
    for await (const audio of tts.stream(text, {
      speed: opts.speed ?? 1,
      seed: opts.seed ?? 0,
      onPiece: (info) => {
        piece += 1
        collector.onPiece(info)
        opts.onSynthProgress?.({
          phase: 'synthesizing',
          label:
            pieceTotal > 0
              ? `Ses üretiliyor… (${piece}/${pieceTotal})`
              : `Ses üretiliyor… (${piece})`,
          piece,
          pieces: pieceTotal || undefined,
        })
      },
    })) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      chunks.push(audio)
      pcm += audio.length
      opts.onChunk?.(audio, i++)
      player?.play(audio)
    }
  } catch (err) {
    player?.stop()
    throw err
  }

  if (!chunks.length || pcm < 100) {
    throw new Error('Ses üretilemedi — metin model tarafından boşaldı olabilir')
  }

  const timings = collector.finalize(pcm)
  return {
    blob: wavBlob(chunks),
    chunks,
    sampleRate: RATE,
    timings,
    timingsJson: timingsToJson(timings),
  }
}

/**
 * Synthesize text → WAV + word timings.
 * Uses WASM by default; if a leftover WebGPU session fails, resets and retries WASM.
 */
export async function synthesizeEmaWav(
  text: string,
  opts: {
    speed?: number
    seed?: number
    signal?: AbortSignal
    onProgress?: (p: EmaLoadProgress) => void
    onSynthProgress?: (p: EmaSynthProgress) => void
    onChunk?: (chunk: Float32Array, index: number) => void
    play?: boolean
  } = {},
): Promise<SynthResult> {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim()
  if (trimmed.length < 2) throw new Error('Okunacak metin yok')

  // Drop a broken WebGPU singleton from earlier sessions in this tab
  if (lastBackend === 'webgpu') {
    await resetEma()
  }

  opts.onSynthProgress?.({
    phase: 'loading',
    label: 'Ses modeli hazırlanıyor…',
  })

  let tts = await ensureEma({
    onProgress: opts.onProgress,
    precision: 'fp32',
    forceBackend: 'wasm',
  })
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  opts.onSynthProgress?.({
    phase: 'synthesizing',
    label: 'Ses üretiliyor…',
  })

  try {
    return await runStream(tts, trimmed, opts)
  } catch (err) {
    if (
      opts.signal?.aborted ||
      (err as DOMException)?.name === 'AbortError'
    ) {
      throw err
    }
    if (!isRecoverableInferenceError(err) && lastBackend === 'wasm') {
      throw err
    }
    await resetEma()
    tts = await ensureEma({
      onProgress: opts.onProgress,
      precision: 'fp32',
      forceBackend: 'wasm',
    })
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    opts.onSynthProgress?.({
      phase: 'synthesizing',
      label: 'Ses üretiliyor (yeniden)…',
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
