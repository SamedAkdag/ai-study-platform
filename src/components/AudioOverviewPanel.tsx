import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  buildAudioOverview,
  generateAudioOverview,
  loadCachedAudioOverview,
  type AudioOverviewScript,
} from '@/lib/audioOverview'
import {
  getStoredLang,
  getStoredRate,
  isTtsSupported,
  speakText,
  stopSpeech,
  type TtsStatus,
} from '@/lib/tts'
import { friendlyAiError } from '@/lib/errors'
import EmaTts from '@/components/EmaTts'
import LessonWaitMood from '@/components/LessonWaitMood'

type Props = {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  defaultOpen?: boolean
}

function estimateListenMinutes(narration: string): number {
  const chars = narration.replace(/\s+/g, ' ').trim().length
  return Math.max(1, Math.round(chars / 14 / 60))
}

/** Continuous teacher lecture + TTS. */
export default function AudioOverviewPanel({
  title,
  summary,
  keyConcepts,
  markdown,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<TtsStatus>(
    isTtsSupported() ? 'idle' : 'unsupported',
  )
  const cancelRef = useRef(false)

  const inputKey = useMemo(
    () => ({ title, summary, keyConcepts, markdown }),
    [title, summary, keyConcepts, markdown],
  )

  const fallback = useMemo(
    () => buildAudioOverview(inputKey),
    [inputKey],
  )

  const [script, setScript] = useState<AudioOverviewScript>(() => {
    const cached = loadCachedAudioOverview(inputKey)
    return cached && cached.narration.length >= 120 ? cached : fallback
  })

  useEffect(() => {
    const cached = loadCachedAudioOverview(inputKey)
    setScript(cached && cached.narration.length >= 120 ? cached : fallback)
    stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when unit changes
  }, [title, summary, markdown, fallback])

  const genMutation = useMutation({
    mutationFn: (force: boolean) =>
      generateAudioOverview({ ...inputKey, force }),
    onSuccess: (next) => {
      setScript(next)
    },
  })

  const autoTriedKey = useRef('')
  useEffect(() => {
    if (!open) return
    if (script.source === 'ai' && script.narration.length >= 400) return
    if (genMutation.isPending) return
    const key = `${title}::${(markdown || '').slice(0, 80)}`
    if (autoTriedKey.current === key) return
    autoTriedKey.current = key
    genMutation.mutate(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title, markdown, script.source])

  useEffect(() => {
    return () => {
      cancelRef.current = true
      stopSpeech()
    }
  }, [])

  function playFrom(_startAt = 0) {
    if (!isTtsSupported()) return
    cancelRef.current = false
    setPlaying(true)
    stopSpeech()
    // Full narration via EMA (single stream) — lighter than turn-by-turn Google TTS
    speakText(script.narration, {
      rate: getStoredRate() * 0.96,
      lang: getStoredLang(),
      onStatus: (s) => {
        setStatus(s)
        if (s === 'idle' && !cancelRef.current) setPlaying(false)
      },
      onEnd: () => {
        if (cancelRef.current) return
        setPlaying(false)
        setStatus('idle')
      },
      onError: () => {
        setPlaying(false)
        setStatus('idle')
      },
    })
  }

  function stop() {
    cancelRef.current = true
    stopSpeech()
    setPlaying(false)
    setStatus('idle')
  }

  const isAi = script.source === 'ai'
  const mins = estimateListenMinutes(script.narration)
  const paragraphs = script.narration
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <section className="studio-panel studio-panel--audio" aria-label="Dinle">
      <button
        type="button"
        className="studio-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <p className="section-label mb-0.5">Dinle</p>
          <p className="studio-panel__title">Hoca · ders anlatımı</p>
        </div>
        <span className="studio-panel__chev">{open ? 'Gizle' : 'Aç'}</span>
      </button>

      {open ? (
        <div className="studio-panel__body">
          <p className="muted text-sm leading-relaxed">
            Tek bir akış: tahta başındaki öğretmen gibi konuşuyor — özet değil,
            ders. Okuyabilir veya baştan sona dinleyebilirsin.
            {isAi
              ? ' Metin AI ile üretildi; ses tarayıcı TTS.'
              : ' Geçici taslak gösteriliyor; AI dersi hazırlanıyor veya yenilenebilir.'}
          </p>

          <div className="audio-overview__actions">
            {status === 'unsupported' ? (
              <p className="muted text-xs">Bu tarayıcıda sesli okuma yok.</p>
            ) : playing ? (
              <button type="button" className="btn-ghost text-sm" onClick={stop}>
                Durdur
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={!script.narration || genMutation.isPending}
                onClick={() => playFrom(0)}
              >
                Dersi dinle
              </button>
            )}
            <button
              type="button"
              className="btn-ghost text-sm"
              disabled={genMutation.isPending || playing}
              onClick={() => genMutation.mutate(true)}
            >
              {genMutation.isPending ? 'Yazılıyor…' : 'Dersi yenile'}
            </button>
          </div>

          {genMutation.isPending ? (
            <LessonWaitMood kind="script" size="compact" />
          ) : null}
          {playing ? (
            <LessonWaitMood kind="speaking" size="compact" />
          ) : null}
          {genMutation.isError ? (
            <p className="audio-overview__error text-xs" role="alert">
              {friendlyAiError(genMutation.error)} — taslak dinlenebilir.
            </p>
          ) : null}
          {!genMutation.isPending && !playing ? (
            <p className="muted text-[11px]">
              {isAi ? 'AI · ' : 'Taslak · '}
              Ders anlatımı · ~{mins} dk
            </p>
          ) : null}

          <article
            className={`audio-overview__lecture${playing ? ' is-playing' : ''}`}
            aria-label="Ders anlatımı"
          >
            <header className="audio-overview__lecture-head">
              <p className="section-label mb-0.5">Hoca konuşuyor</p>
              <h2 className="audio-overview__blog-title">{script.title}</h2>
            </header>
            <div className="audio-overview__lecture-body">
              {paragraphs.map((p, i) => (
                <p key={`${i}-${p.slice(0, 24)}`}>{p}</p>
              ))}
            </div>
          </article>

          {script.narration.trim().length > 40 ? (
            <div className="audio-overview__ema">
              <p className="section-label mb-1">Ses dosyası indir</p>
              <EmaTts
                compact
                preload={false}
                title={script.title || title || 'ders'}
                initialText={script.narration}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
