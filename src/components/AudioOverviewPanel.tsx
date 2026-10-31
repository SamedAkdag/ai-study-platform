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
  listVoices,
  pickVoice,
  speakText,
  stopSpeech,
  type TtsStatus,
} from '@/lib/tts'
import { friendlyAiError } from '@/lib/errors'
import EmaTts from '@/components/EmaTts'

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
  const [turnIndex, setTurnIndex] = useState(0)
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
    setTurnIndex(0)
    stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when unit changes
  }, [title, summary, markdown, fallback])

  const genMutation = useMutation({
    mutationFn: (force: boolean) =>
      generateAudioOverview({ ...inputKey, force }),
    onSuccess: (next) => {
      setScript(next)
      setTurnIndex(0)
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

  function teacherVoice(): string | undefined {
    const voices = listVoices()
    const lang = getStoredLang()
    const pool = voices.filter((v) =>
      (v.lang || '')
        .toLowerCase()
        .startsWith(lang.split(/[-_]/)[0]!.toLowerCase()),
    )
    return pool[0]?.voiceURI ?? pickVoice(voices, undefined, lang)?.voiceURI
  }

  function playFrom(startAt: number) {
    if (!isTtsSupported()) return
    cancelRef.current = false
    setPlaying(true)
    setTurnIndex(startAt)

    const turns = script.turns
    const run = (i: number) => {
      if (cancelRef.current || i >= turns.length) {
        setPlaying(false)
        setStatus('idle')
        return
      }
      setTurnIndex(i)
      speakText(turns[i]!.text, {
        rate: getStoredRate() * 0.96,
        lang: getStoredLang(),
        voiceUri: teacherVoice(),
        onStatus: setStatus,
        onEnd: () => {
          if (cancelRef.current) return
          run(i + 1)
        },
        onError: () => {
          setPlaying(false)
          setStatus('idle')
        },
      })
    }

    stopSpeech()
    window.setTimeout(() => run(startAt), 80)
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
            {!playing && turnIndex > 0 ? (
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => playFrom(turnIndex)}
              >
                Kaldığı yerden
              </button>
            ) : null}
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
            <p className="muted text-xs">Hoca anlatımı yazılıyor…</p>
          ) : null}
          {genMutation.isError ? (
            <p className="audio-overview__error text-xs" role="alert">
              {friendlyAiError(genMutation.error)} — taslak dinlenebilir.
            </p>
          ) : null}
          {!genMutation.isPending ? (
            <p className="muted text-[11px]">
              {isAi ? 'AI · ' : 'Taslak · '}
              Ders anlatımı · ~{mins} dk
              {playing ? ' · dinleniyor' : ''}
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
