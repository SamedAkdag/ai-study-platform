/**
 * Site-wide EMA speak API (replaces Web Speech for listening).
 */
import {
  ensureEma,
  synthesizeEmaWav,
  type EmaLoadProgress,
} from '@/lib/emaEngine'
import type { EmaChunkPlayer } from '@/lib/emaAudioPlayer'
import type { TtsStatus } from '@/lib/tts'

export type EmaSpeakHandlers = {
  rate?: number
  onStatus?: (s: TtsStatus) => void
  onChunk?: (index: number, total: number, text: string) => void
  onEnd?: () => void
  onError?: (message: string) => void
  onLoadProgress?: (p: EmaLoadProgress) => void
}

let speakToken = 0
let activeAbort: AbortController | null = null
let paused = false
let activePlayer: EmaChunkPlayer | null = null

export function stopEmaSpeak() {
  speakToken += 1
  activeAbort?.abort()
  activeAbort = null
  paused = false
  activePlayer?.stop()
  activePlayer = null
}

export function pauseEmaSpeak() {
  paused = true
  void activePlayer?.suspend()
}

export function resumeEmaSpeak() {
  paused = false
  void activePlayer?.resumePlayback()
}

export function isEmaSpeakActive() {
  return activeAbort != null && !activeAbort.signal.aborted
}

/** Speak plain text with EMA — streams audio as chunks arrive. */
export function speakEmaText(text: string, opts: EmaSpeakHandlers = {}) {
  const plain = String(text || '').replace(/\s+/g, ' ').trim()
  if (plain.length < 2) {
    opts.onError?.('Okunacak metin yok')
    opts.onStatus?.('idle')
    return
  }

  stopEmaSpeak()
  const token = speakToken
  const ac = new AbortController()
  activeAbort = ac
  paused = false

  opts.onStatus?.('speaking')

  void (async () => {
    try {
      await ensureEma({ onProgress: opts.onLoadProgress })
      if (token !== speakToken || ac.signal.aborted) return

      await synthesizeEmaWav(plain, {
        play: true,
        speed: Math.min(1.35, Math.max(0.75, opts.rate ?? 1)),
        signal: ac.signal,
        onProgress: opts.onLoadProgress,
        shouldPause: () => paused && token === speakToken,
        onPlayer: (p) => {
          if (token === speakToken) activePlayer = p
        },
        onSynthProgress: (p) => {
          if (token !== speakToken) return
          opts.onChunk?.(p.piece ?? 0, Math.max(p.piece ?? 1, 1), p.label)
        },
      })

      if (token !== speakToken) return
      opts.onStatus?.('idle')
      opts.onEnd?.()
    } catch (err) {
      if (token !== speakToken) return
      if ((err as DOMException)?.name === 'AbortError') {
        opts.onStatus?.('idle')
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      opts.onError?.(msg || 'Sesli okuma hatası')
      opts.onStatus?.('idle')
    } finally {
      if (token === speakToken) {
        activeAbort = null
        // player self-closes after queued audio; clear handle
        activePlayer = null
      }
    }
  })()
}

export function warmEmaSpeak(onProgress?: (p: EmaLoadProgress) => void) {
  return ensureEma({ onProgress })
}
