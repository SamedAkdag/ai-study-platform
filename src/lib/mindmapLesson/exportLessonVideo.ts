/**
 * Record the mind-map lesson as WebM (map frames + EMA audio).
 * Drives visual callbacks per segment so the live map can stay in sync.
 */
import type { LessonTimeline } from '@/lib/mindmapLesson/types'
import html2canvas from 'html2canvas'

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
  return 'video/webm'
}

export type LessonVideoProgress = {
  label: string
  fraction: number
}

/**
 * Capture `mapEl` while playing timeline audio into a downloadable WebM blob.
 * `onSegment` is called before each segment so the UI can open/zoom that node.
 */
export async function exportLessonVideo(input: {
  mapEl: HTMLElement
  timeline: LessonTimeline
  signal?: AbortSignal
  onSegment?: (segIndex: number, nodeId: string) => void | Promise<void>
  onProgress?: (p: LessonVideoProgress) => void
}): Promise<Blob> {
  const { mapEl, timeline } = input
  if (!timeline.segments.length) {
    throw new Error('Önce ders sesini üretin')
  }

  const rect = mapEl.getBoundingClientRect()
  const width = Math.max(640, Math.round(rect.width) || 960)
  const height = Math.max(360, Math.round(rect.height) || 540)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas desteklenmiyor')

  const audioCtx = new AudioContext()
  const dest = audioCtx.createMediaStreamDestination()
  const fps = 8
  const vStream = canvas.captureStream(fps)
  const mixed = new MediaStream([
    ...vStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ])

  const mime = pickMime()
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(mixed, {
    mimeType: mime,
    videoBitsPerSecond: 2_500_000,
  })
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start(250)

  const total = timeline.segments.length
  try {
    for (let i = 0; i < total; i++) {
      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const seg = timeline.segments[i]!
      input.onProgress?.({
        label: `Video: ${seg.title}`,
        fraction: i / total,
      })
      await input.onSegment?.(i, seg.nodeId)
      // Let React Flow layout + camera settle
      await new Promise((r) => setTimeout(r, 420))

      const shot = await html2canvas(mapEl, {
        backgroundColor: null,
        scale: Math.min(2, window.devicePixelRatio || 1),
        logging: false,
        useCORS: true,
      })
      g.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--paper')
        .trim() || '#f7f4ef'
      g.fillRect(0, 0, width, height)
      const scale = Math.min(width / shot.width, height / shot.height)
      const dw = shot.width * scale
      const dh = shot.height * scale
      g.drawImage(shot, (width - dw) / 2, (height - dh) / 2, dw, dh)

      // Draw title caption
      g.fillStyle = 'rgba(20,28,24,0.72)'
      g.fillRect(0, height - 48, width, 48)
      g.fillStyle = '#fff'
      g.font = '600 18px system-ui,sans-serif'
      g.fillText(seg.title.slice(0, 64), 16, height - 18)

      const buffer = await decodeWav(audioCtx, seg.blob)
      const src = audioCtx.createBufferSource()
      src.buffer = buffer
      src.connect(dest)
      // Also keep painting while audio plays
      const durMs = Math.max(400, buffer.duration * 1000)
      const started = audioCtx.currentTime
      src.start()
      const endAt = performance.now() + durMs
      while (performance.now() < endAt) {
        if (input.signal?.aborted) {
          src.stop()
          throw new DOMException('Aborted', 'AbortError')
        }
        // Refresh frame occasionally so MediaRecorder gets motion
        g.drawImage(shot, (width - dw) / 2, (height - dh) / 2, dw, dh)
        g.fillStyle = 'rgba(20,28,24,0.72)'
        g.fillRect(0, height - 48, width, 48)
        g.fillStyle = '#fff'
        g.font = '600 18px system-ui,sans-serif'
        g.fillText(seg.title.slice(0, 64), 16, height - 18)
        await new Promise((r) => setTimeout(r, 1000 / fps))
      }
      void started
    }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    await audioCtx.close().catch(() => {})
    vStream.getTracks().forEach((t) => t.stop())
  }

  input.onProgress?.({ label: 'Video hazır', fraction: 1 })
  return new Blob(chunks, { type: mime })
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
