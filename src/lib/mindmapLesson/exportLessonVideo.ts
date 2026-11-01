/**
 * Offline lesson video: high-res map stills + EMA audio → WebM.
 * Not a desktop screen capture — renders to a fixed 1080p canvas.
 */
import type { LessonTimeline } from '@/lib/mindmapLesson/types'
import { toCanvas } from 'html-to-image'

/** Export master size (independent of on-screen map widget). */
const EXPORT_W = 1920
const EXPORT_H = 1080
const EXPORT_FPS = 24
const VIDEO_BPS = 10_000_000
const AUDIO_BPS = 192_000
/** Capture the live map sharper than CSS pixels, then letterbox into 1080p. */
const CAPTURE_PIXEL_RATIO = 3

async function decodeWav(
  ctx: AudioContext,
  blob: Blob,
): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer()
  return ctx.decodeAudioData(buf.slice(0))
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const m of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(m)
    ) {
      return m
    }
  }
  return ''
}

function paperColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--paper')
      .trim() || '#f7f4ef'
  )
}

async function captureMapHiRes(mapEl: HTMLElement): Promise<HTMLCanvasElement> {
  // Capture the whole stage (not only .react-flow) so the lesson speech
  // bubble — a sibling overlay — is in the frame with the zoomed node.
  return toCanvas(mapEl, {
    pixelRatio: CAPTURE_PIXEL_RATIO,
    cacheBust: true,
    quality: 1,
    width: mapEl.clientWidth || EXPORT_W,
    height: mapEl.clientHeight || EXPORT_H,
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true
      if (node.classList.contains('react-flow__controls')) return false
      if (node.classList.contains('react-flow__minimap')) return false
      if (node.classList.contains('react-flow__attribution')) return false
      if (node.classList.contains('react-flow__panel')) return false
      if (node.classList.contains('mind-map-hud')) return false
      if (node.classList.contains('lesson-ask')) return false
      // Keep .lesson-bubble — that is the on-map reading cloud
      return true
    },
  })
}

/**
 * Screen-space box of the decision-tree content (active nodes + bubble),
 * relative to mapEl — skips dimmed / faded nodes so empty paper is dropped.
 */
function treeContentRect(mapEl: HTMLElement): {
  x: number
  y: number
  w: number
  h: number
} | null {
  const mapRect = mapEl.getBoundingClientRect()
  if (mapRect.width < 8 || mapRect.height < 8) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hits = 0

  const absorb = (r: DOMRect) => {
    const x0 = r.left - mapRect.left
    const y0 = r.top - mapRect.top
    const x1 = x0 + r.width
    const y1 = y0 + r.height
    if (r.width < 2 || r.height < 2) return
    if (x1 < 0 || y1 < 0 || x0 > mapRect.width || y0 > mapRect.height) return
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
    hits++
  }

  mapEl.querySelectorAll('.react-flow__node').forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    if (el.classList.contains('mind-flow-node--dim')) return
    const op = Number.parseFloat(getComputedStyle(el).opacity || '1')
    if (op < 0.35) return
    absorb(el.getBoundingClientRect())
  })

  const bubble = mapEl.querySelector('.lesson-bubble')
  if (bubble instanceof HTMLElement) {
    const op = Number.parseFloat(getComputedStyle(bubble).opacity || '1')
    if (op > 0.2) absorb(bubble.getBoundingClientRect())
  }

  if (hits < 1 || !Number.isFinite(minX)) return null

  // Keep a little air around the tree; clamp to the map
  const padX = Math.max(28, (maxX - minX) * 0.08)
  const padY = Math.max(24, (maxY - minY) * 0.1)
  const x = Math.max(0, minX - padX)
  const y = Math.max(0, minY - padY)
  const w = Math.min(mapRect.width - x, maxX + padX - x)
  const h = Math.min(mapRect.height - y, maxY + padY - y)
  if (w < 64 || h < 64) return null

  // Prefer a ~16:9 window so cover-scale into 1080p stays sharp
  const target = 16 / 9
  const aspect = w / h
  if (aspect > target * 1.08) {
    const nh = w / target
    const extra = nh - h
    const y2 = Math.max(0, y - extra / 2)
    return {
      x,
      y: y2,
      w,
      h: Math.min(mapRect.height - y2, nh),
    }
  }
  if (aspect < target / 1.08) {
    const nw = h * target
    const extra = nw - w
    const x2 = Math.max(0, x - extra / 2)
    return {
      x: x2,
      y,
      w: Math.min(mapRect.width - x2, nw),
      h,
    }
  }
  return { x, y, w, h }
}

/** Crop captured stage to the tree bbox, scaled by html-to-image pixelRatio. */
function cropToTree(
  shot: HTMLCanvasElement,
  mapEl: HTMLElement,
): HTMLCanvasElement {
  const box = treeContentRect(mapEl)
  if (!box) return shot

  const sx = shot.width / Math.max(1, mapEl.clientWidth || EXPORT_W)
  const sy = shot.height / Math.max(1, mapEl.clientHeight || EXPORT_H)
  const cx = Math.round(box.x * sx)
  const cy = Math.round(box.y * sy)
  const cw = Math.max(32, Math.round(box.w * sx))
  const ch = Math.max(32, Math.round(box.h * sy))
  if (cw >= shot.width * 0.92 && ch >= shot.height * 0.92) return shot

  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  const og = out.getContext('2d')
  if (!og) return shot
  og.fillStyle = paperColor()
  og.fillRect(0, 0, cw, ch)
  og.drawImage(shot, cx, cy, cw, ch, 0, 0, cw, ch)
  return out
}

function drawCaption(
  g: CanvasRenderingContext2D,
  title: string,
  width: number,
  height: number,
) {
  const barH = 72
  g.fillStyle = 'rgba(18, 24, 22, 0.78)'
  g.fillRect(0, height - barH, width, barH)
  // Soft top edge
  const grad = g.createLinearGradient(0, height - barH - 24, 0, height - barH)
  grad.addColorStop(0, 'rgba(18,24,22,0)')
  grad.addColorStop(1, 'rgba(18,24,22,0.55)')
  g.fillStyle = grad
  g.fillRect(0, height - barH - 24, width, 24)

  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.font = '600 18px system-ui,sans-serif'
  g.fillText('Studium · Harita dersi', 36, height - 42)
  g.fillStyle = '#fff'
  g.font = '650 28px system-ui,sans-serif'
  g.fillText(title.slice(0, 72), 36, height - 14)
}

/**
 * Fill 1080p with the cropped tree frame (cover) + mild drift.
 * Empty platform chrome / paper margins are already cut by cropToTree.
 */
function paintKenBurns(
  g: CanvasRenderingContext2D,
  shot: HTMLCanvasElement,
  title: string,
  t: number,
  dur: number,
) {
  const width = g.canvas.width
  const height = g.canvas.height
  const paper = paperColor()
  g.fillStyle = paper
  g.fillRect(0, 0, width, height)

  const progress = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0
  const zoom = 1 + progress * 0.025
  const baseScale = Math.max(width / shot.width, height / shot.height) * zoom
  const w = shot.width * baseScale
  const h = shot.height * baseScale
  const ox = (width - w) / 2 - progress * 8
  const oy = (height - h) / 2 - progress * 5
  g.drawImage(shot, ox, oy, w, h)
  drawCaption(g, title, width, height)
}

export type LessonVideoProgress = {
  label: string
  fraction: number
}

export async function exportLessonVideo(input: {
  mapEl: HTMLElement
  timeline: LessonTimeline
  signal?: AbortSignal
  /** After camera + bubble are set; wait for React paint before capture. */
  onSegment?: (segIndex: number, nodeId: string) => void | Promise<void>
  /** Advance karaoke highlight while the segment audio plays (optional). */
  onCaptionTick?: (segIndex: number, wordIndex: number) => void | Promise<void>
  onProgress?: (p: LessonVideoProgress) => void
}): Promise<Blob> {
  const { mapEl, timeline } = input
  if (!timeline.segments.length) {
    throw new Error('Önce ders sesini üretin (Dersi Başlat)')
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Bu tarayıcı video kaydını desteklemiyor (Chrome/Edge dene)')
  }

  const mime = pickMime()
  if (!mime) {
    throw new Error(
      'WebM kaydı desteklenmiyor. Chrome veya Edge ile tekrar dene.',
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_W
  canvas.height = EXPORT_H
  const g = canvas.getContext('2d', { alpha: false })
  if (!g) throw new Error('Canvas desteklenmiyor')

  const audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') await audioCtx.resume()
  const dest = audioCtx.createMediaStreamDestination()

  const keepAlive = audioCtx.createGain()
  keepAlive.gain.value = 0.0001
  const osc = audioCtx.createOscillator()
  osc.frequency.value = 20
  osc.connect(keepAlive)
  keepAlive.connect(dest)
  osc.start()

  const vStream = canvas.captureStream(EXPORT_FPS)
  const mixed = new MediaStream([
    ...vStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ])

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(mixed, {
    mimeType: mime,
    videoBitsPerSecond: VIDEO_BPS,
    audioBitsPerSecond: AUDIO_BPS,
  })
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => reject(new Error('Video kaydı hata verdi'))
  })
  recorder.start(100)

  // Prime one paper frame so the first second isn't black
  g.fillStyle = paperColor()
  g.fillRect(0, 0, EXPORT_W, EXPORT_H)

  // Temporarily size the map stage to 1080p so nodes render sharp (not upscaled UI)
  const prevStyle = {
    width: mapEl.style.width,
    height: mapEl.style.height,
    maxHeight: mapEl.style.maxHeight,
    minHeight: mapEl.style.minHeight,
  }
  mapEl.style.width = `${EXPORT_W}px`
  mapEl.style.height = `${EXPORT_H}px`
  mapEl.style.maxHeight = `${EXPORT_H}px`
  mapEl.style.minHeight = `${EXPORT_H}px`
  void mapEl.offsetHeight

  const total = timeline.segments.length
  try {
    for (let i = 0; i < total; i++) {
      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const seg = timeline.segments[i]!
      if (!seg.blob || seg.blob.size < 64) {
        console.warn('[lesson video] skip empty blob', seg.id)
        continue
      }

      input.onProgress?.({
        label: `1080p kare: ${seg.title} (${i + 1}/${total})`,
        fraction: i / Math.max(1, total),
      })

      // Camera + speech bubble after resize so fitView uses the large stage
      await input.onSegment?.(i, seg.nodeId)
      // Let React Flow settle + bubble position itself on the focused node
      await new Promise((r) => setTimeout(r, 1400))

      const segWords = (timeline.words ?? []).filter((w) => w.segmentId === seg.id)
      const fallbackWords = seg.text
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)

      const captureSafe = async (): Promise<HTMLCanvasElement> => {
        try {
          const full = await captureMapHiRes(mapEl)
          return cropToTree(full, mapEl)
        } catch (err) {
          console.warn('[lesson video] capture failed', err)
          const blank = document.createElement('canvas')
          blank.width = EXPORT_W
          blank.height = EXPORT_H
          const sg = blank.getContext('2d')
          if (sg) {
            sg.fillStyle = paperColor()
            sg.fillRect(0, 0, blank.width, blank.height)
          }
          return blank
        }
      }

      let shot = await captureSafe()
      let lastCaptureWord = -1

      const buffer = await decodeWav(audioCtx, seg.blob)
      const src = audioCtx.createBufferSource()
      src.buffer = buffer
      src.connect(dest)
      const durSec = Math.max(0.5, buffer.duration)
      const durMs = durSec * 1000
      src.start()

      const t0 = performance.now()
      while (performance.now() - t0 < durMs) {
        if (input.signal?.aborted) {
          try {
            src.stop()
          } catch {
            /* ignore */
          }
          throw new DOMException('Aborted', 'AbortError')
        }
        const t = (performance.now() - t0) / 1000
        // Word timings on the timeline are absolute; audio clock here is segment-local
        const absT = (seg.start ?? 0) + t

        // Refresh still every few spoken words so the reading cloud advances
        let wordIdx = -1
        if (segWords.length) {
          for (let wi = 0; wi < segWords.length; wi++) {
            if (segWords[wi]!.s <= absT) wordIdx = wi
            else break
          }
        } else if (fallbackWords.length && durSec > 0) {
          wordIdx = Math.min(
            fallbackWords.length - 1,
            Math.floor((t / durSec) * fallbackWords.length),
          )
        }
        if (
          wordIdx >= 0 &&
          (lastCaptureWord < 0 || wordIdx - lastCaptureWord >= 4)
        ) {
          await input.onCaptionTick?.(i, wordIdx)
          await new Promise((r) => setTimeout(r, 60))
          shot = await captureSafe()
          lastCaptureWord = wordIdx
        }

        paintKenBurns(g, shot, seg.title, t, durSec)
        await new Promise((r) => setTimeout(r, 1000 / EXPORT_FPS))
      }
      try {
        src.stop()
      } catch {
        /* ended */
      }
    }
  } finally {
    mapEl.style.width = prevStyle.width
    mapEl.style.height = prevStyle.height
    mapEl.style.maxHeight = prevStyle.maxHeight
    mapEl.style.minHeight = prevStyle.minHeight
    try {
      osc.stop()
    } catch {
      /* ignore */
    }
    if (recorder.state === 'recording') {
      try {
        recorder.requestData()
      } catch {
        /* ignore */
      }
      recorder.stop()
    }
    await stopped.catch(() => {})
    await audioCtx.close().catch(() => {})
    vStream.getTracks().forEach((t) => t.stop())
    dest.stream.getTracks().forEach((t) => t.stop())
  }

  const blob = new Blob(chunks, { type: mime })
  if (blob.size < 2048) {
    throw new Error(
      'Video boş oluştu. Ders sesi hazır olduktan sonra Chrome/Edge ile tekrar dene.',
    )
  }
  input.onProgress?.({ label: '1080p video hazır', fraction: 1 })
  return blob
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
