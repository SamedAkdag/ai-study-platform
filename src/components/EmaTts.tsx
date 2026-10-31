import { useEffect, useRef, useState } from 'react'
import {
  downloadBlob,
  ensureEma,
  isEmaReady,
  resetEma,
  safeDownloadName,
  synthesizeEmaWav,
  getEmaBackend,
  type EmaLoadProgress,
  type EmaTimingTrack,
} from '@/lib/emaEngine'
import { wordIndexAtTime } from '@/lib/emaTimings'

type Props = {
  /** Pre-filled text (e.g. lecture narration). */
  initialText?: string
  /** Suggested download filename stem. */
  title?: string
  /** Compact embed (no big textarea chrome). */
  compact?: boolean
  /** Auto-start model warm-up when mounted. */
  preload?: boolean
  className?: string
}

type Phase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'synthesizing'
  | 'done'
  | 'error'

/**
 * In-browser Turkish TTS (EMA Lightning ONNX) + word-timing karaoke.
 * Text never leaves the device; weights cache in Cache Storage after first fetch.
 */
export default function EmaTts({
  initialText = '',
  title = 'ses',
  compact = false,
  preload = true,
  className = '',
}: Props) {
  const [text, setText] = useState(initialText)
  const [phase, setPhase] = useState<Phase>(() =>
    isEmaReady() ? 'ready' : 'idle',
  )
  const [progress, setProgress] = useState<EmaLoadProgress | null>(null)
  const [synthLabel, setSynthLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wavUrl, setWavUrl] = useState<string | null>(null)
  const [wavBlob, setWavBlob] = useState<Blob | null>(null)
  const [timings, setTimings] = useState<EmaTimingTrack | null>(null)
  const [timingsJson, setTimingsJson] = useState<string | null>(null)
  const [activeWord, setActiveWord] = useState(-1)
  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    setText(initialText)
  }, [initialText])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (wavUrl) URL.revokeObjectURL(wavUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Previous WebGPU sessions in this tab break synth — drop them once.
    if (getEmaBackend() === 'webgpu') {
      void resetEma()
    }
  }, [])

  useEffect(() => {
    if (!preload || isEmaReady()) {
      if (isEmaReady()) setPhase('ready')
      return
    }
    let cancelled = false
    setPhase('loading')
    setError(null)
    ensureEma({
      forceBackend: 'wasm',
      onProgress: (p) => {
        if (!cancelled) setProgress(p)
      },
    })
      .then(() => {
        if (cancelled) return
        setPhase('ready')
        setProgress(null)
      })
      .catch(() => {
        if (cancelled) return
        setPhase('error')
        setError(
          'Model yüklenemedi, lütfen internet bağlantınızı kontrol edip tekrar deneyin',
        )
      })
    return () => {
      cancelled = true
    }
  }, [preload])

  // Sync karaoke highlight to <audio> clock
  useEffect(() => {
    const el = audioRef.current
    const words = timings?.words
    if (!el || !words?.length) {
      setActiveWord(-1)
      return
    }

    let raf = 0
    const tick = () => {
      if (!el.paused && !el.ended) {
        const idx = wordIndexAtTime(words, el.currentTime)
        setActiveWord((prev) => (prev === idx ? prev : idx))
        raf = requestAnimationFrame(tick)
      }
    }

    const onPlay = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const onPause = () => cancelAnimationFrame(raf)
    const onSeek = () => {
      setActiveWord(wordIndexAtTime(words, el.currentTime))
    }
    const onEnded = () => {
      cancelAnimationFrame(raf)
      setActiveWord(words.length - 1)
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('playing', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('seeked', onSeek)
    el.addEventListener('ended', onEnded)
    el.addEventListener('timeupdate', onSeek)

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('playing', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('seeked', onSeek)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('timeupdate', onSeek)
    }
  }, [timings, wavUrl])

  useEffect(() => {
    if (activeWord < 0) return
    wordRefs.current[activeWord]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }, [activeWord])

  async function warmModel() {
    setPhase('loading')
    setError(null)
    try {
      if (getEmaBackend() === 'webgpu') await resetEma()
      await ensureEma({
        forceBackend: 'wasm',
        onProgress: setProgress,
      })
      setPhase('ready')
      setProgress(null)
    } catch {
      setPhase('error')
      setError(
        'Model yüklenemedi, lütfen internet bağlantınızı kontrol edip tekrar deneyin',
      )
    }
  }

  async function convert() {
    const body = text.trim()
    if (body.length < 2) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    if (wavUrl) {
      URL.revokeObjectURL(wavUrl)
      setWavUrl(null)
      setWavBlob(null)
    }
    setTimings(null)
    setTimingsJson(null)
    setActiveWord(-1)
    setSynthLabel(null)

    setPhase('synthesizing')
    setError(null)
    try {
      if (getEmaBackend() === 'webgpu') await resetEma()
      if (!isEmaReady()) {
        setPhase('loading')
        setSynthLabel('Ses modeli hazırlanıyor…')
        await ensureEma({ forceBackend: 'wasm', onProgress: setProgress })
        setProgress(null)
        setPhase('synthesizing')
      }
      // Full WAV + timings, then <audio> play so karaoke stays in sync
      const result = await synthesizeEmaWav(body, {
        play: false,
        signal: ac.signal,
        onProgress: setProgress,
        onSynthProgress: (p) => setSynthLabel(p.label),
      })
      if (ac.signal.aborted) return
      const url = URL.createObjectURL(result.blob)
      setWavUrl(url)
      setWavBlob(result.blob)
      setTimings(result.timings)
      setTimingsJson(result.timingsJson)
      setSynthLabel(null)
      setPhase('done')
      window.setTimeout(() => {
        const a = audioRef.current
        if (!a) return
        a.currentTime = 0
        void a.play().catch(() => {})
      }, 80)
    } catch (err) {
      setSynthLabel(null)
      if ((err as DOMException)?.name === 'AbortError') {
        setPhase(isEmaReady() ? 'ready' : 'idle')
        return
      }
      setPhase('error')
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        /fetch|HTTP|network|Failed to fetch|load|Cache/i.test(msg)
          ? 'Model yüklenemedi, lütfen internet bağlantınızı kontrol edip tekrar deneyin'
          : msg || 'Ses üretilemedi',
      )
    }
  }

  function stop() {
    abortRef.current?.abort()
    audioRef.current?.pause()
    setPhase(isEmaReady() ? 'ready' : 'idle')
  }

  function downloadWav() {
    if (!wavBlob) return
    downloadBlob(wavBlob, safeDownloadName(title, 'wav'))
  }

  function downloadTimings() {
    if (!timingsJson) return
    downloadBlob(
      new Blob([timingsJson], { type: 'application/json;charset=utf-8' }),
      safeDownloadName(title, 'json'),
    )
  }

  function seekToWord(index: number) {
    const w = timings?.words[index]
    const el = audioRef.current
    if (!w || !el) return
    el.currentTime = Math.max(0, w.start)
    void el.play().catch(() => {})
    setActiveWord(index)
  }

  const busy = phase === 'loading' || phase === 'synthesizing'
  const pct = progress
    ? Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100)
    : phase === 'loading'
      ? 5
      : 0

  return (
    <div
      className={`ema-tts${compact ? ' ema-tts--compact' : ''} ${className}`.trim()}
    >
      {!compact ? (
        <>
          <p className="section-label mb-0.5">Türkçe ses (EMA)</p>
          <p className="muted text-sm leading-relaxed mb-2">
            Metin cihazınızda sese dönüşür; sunucuya gönderilmez. İlk yüklemede
            ~36 MB model iner, sonra tarayıcı önbelleğinden açılır.
          </p>
        </>
      ) : (
        <p className="muted text-xs leading-relaxed mb-1.5">
          Kaliteli Türkçe ses + kelime zamanları: model tarayıcıda çalışır.
          Sunucuya metin gitmez.
        </p>
      )}

      <textarea
        className="ema-tts__input"
        rows={compact ? 4 : 8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Türkçe metni buraya yazın…"
        disabled={busy}
        aria-label="TTS metni"
      />

      {phase === 'loading' || phase === 'synthesizing' ? (
        <div className="ema-tts__progress" role="status" aria-live="polite">
          {phase === 'loading' || progress ? (
            <div className="ema-tts__bar" aria-hidden>
              <span style={{ width: `${Math.max(pct, 8)}%` }} />
            </div>
          ) : (
            <div className="ema-tts__bar ema-tts__bar--indeterminate" aria-hidden>
              <span />
            </div>
          )}
          <p className="muted text-xs mb-0">
            {synthLabel ||
              progress?.label ||
              (phase === 'synthesizing'
                ? 'Ses üretiliyor…'
                : 'Ses modeli hazırlanıyor…')}
            {phase === 'loading' && pct > 0 ? ` · %${pct}` : ''}
          </p>
          <p className="muted text-[11px] mb-0">
            {phase === 'synthesizing'
              ? 'Uzun ders metinleri birkaç dakika sürebilir; kelime vurgusu ses bitince açılır.'
              : 'İlk seferde ~36 MB iner; sonra tarayıcı önbelleğinden açılır.'}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="ema-tts__error text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ema-tts__actions">
        {phase === 'error' || phase === 'idle' ? (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => void warmModel()}
          >
            Modeli hazırla
          </button>
        ) : null}
        {phase === 'synthesizing' ? (
          <button type="button" className="btn-ghost text-sm" onClick={stop}>
            İptal
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || text.trim().length < 2}
            onClick={() => void convert()}
          >
            {busy ? 'Üretiliyor…' : 'Sese dönüştür'}
          </button>
        )}
        {wavBlob ? (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={downloadWav}
          >
            WAV indir
          </button>
        ) : null}
        {timingsJson ? (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={downloadTimings}
          >
            Zamanlama JSON
          </button>
        ) : null}
      </div>

      {wavUrl ? (
        <audio
          ref={audioRef}
          className="ema-tts__player"
          controls
          src={wavUrl}
          preload="metadata"
        />
      ) : null}

      {timings?.words?.length ? (
        <div
          className="ema-tts__karaoke"
          aria-label="Kelime takibi"
          role="region"
        >
          <p className="section-label mb-1">Takip</p>
          <p className="ema-tts__karaoke-text">
            {timings.words.map((w) => (
              <span
                key={`${w.index}-${w.start}`}
                ref={(el) => {
                  wordRefs.current[w.index] = el
                }}
                role="button"
                tabIndex={0}
                className={`ema-tts__word${
                  w.index === activeWord ? ' is-active' : ''
                }${
                  activeWord >= 0 && w.index < activeWord ? ' is-past' : ''
                }`}
                onClick={() => seekToWord(w.index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    seekToWord(w.index)
                  }
                }}
              >
                {w.word}{' '}
              </span>
            ))}
          </p>
          <p className="muted text-[11px] mb-0">
            {timings.words.length} kelime · {timings.duration.toFixed(1)} sn —
            kelimeye tıklayınca oradan çalar
          </p>
        </div>
      ) : null}
    </div>
  )
}
