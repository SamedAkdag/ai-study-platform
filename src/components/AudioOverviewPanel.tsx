import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  buildAudioOverview,
  generateAudioOverview,
  loadCachedAudioOverview,
  type AudioOverviewScript,
  type OverviewTurn,
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

type Props = {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  defaultOpen?: boolean
}

/** NotebookLM-style Audio Overview: AI dialogue script + browser TTS. */
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
    return cached && cached.turns.length >= 4 ? cached : fallback
  })

  useEffect(() => {
    const cached = loadCachedAudioOverview(inputKey)
    setScript(cached && cached.turns.length >= 4 ? cached : fallback)
    setTurnIndex(0)
    stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when unit content changes
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
  // Auto-generate AI script once when panel opens (if not already AI-cached)
  useEffect(() => {
    if (!open) return
    if (script.source === 'ai' && script.turns.length >= 6) return
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

  function hostVoice(host: OverviewTurn['host']): string | undefined {
    const voices = listVoices()
    const lang = getStoredLang()
    const pool = voices.filter((v) =>
      (v.lang || '')
        .toLowerCase()
        .startsWith(lang.split(/[-_]/)[0]!.toLowerCase()),
    )
    if (pool.length >= 2) {
      return host === 'A' ? pool[0]?.voiceURI : pool[1]?.voiceURI
    }
    const picked = pickVoice(voices, undefined, lang)
    return picked?.voiceURI
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
      const turn = turns[i]!
      setTurnIndex(i)
      speakText(turn.text, {
        rate: getStoredRate() * (turn.host === 'B' ? 1.02 : 0.98),
        lang: getStoredLang(),
        voiceUri: hostVoice(turn.host),
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

  const active = script.turns[turnIndex]
  const isAi = script.source === 'ai'

  return (
    <section className="studio-panel studio-panel--audio" aria-label="Sesli özet">
      <button
        type="button"
        className="studio-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <p className="section-label mb-0.5">Sesli özet</p>
          <p className="studio-panel__title">Ada & Barış · podcast sohbet</p>
        </div>
        <span className="studio-panel__chev">{open ? 'Gizle' : 'Aç'}</span>
      </button>

      {open ? (
        <div className="studio-panel__body">
          <p className="muted text-sm leading-relaxed">
            İki sunucu ünitenin omurgasını konuşuyor.
            {isAi
              ? ' Senaryo AI ile üretildi; ses tarayıcı TTS.'
              : ' Geçici taslak gösteriliyor; AI senaryo hazırlanıyor veya yenilenebilir.'}
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
                disabled={script.turns.length === 0 || genMutation.isPending}
                onClick={() => playFrom(0)}
              >
                Dinle
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
              {genMutation.isPending ? 'Senaryo yazılıyor…' : 'Senaryoyu yenile'}
            </button>
          </div>

          {genMutation.isPending ? (
            <p className="muted text-xs">Ada & Barış için diyalog yazılıyor…</p>
          ) : null}
          {genMutation.isError ? (
            <p className="audio-overview__error text-xs" role="alert">
              {friendlyAiError(genMutation.error)} — taslak senaryo dinlenebilir.
            </p>
          ) : null}
          {isAi && !genMutation.isPending ? (
            <p className="muted text-[11px]">AI senaryo · {script.turns.length} tur</p>
          ) : null}

          <ol className="audio-overview__script">
            {script.turns.map((t, i) => (
              <li
                key={`${t.host}-${i}-${t.text.slice(0, 24)}`}
                className={`audio-overview__turn ${
                  playing && i === turnIndex ? 'is-active' : ''
                } host-${t.host.toLowerCase()}`}
              >
                <span className="audio-overview__host">{t.name}</span>
                <p>{t.text}</p>
              </li>
            ))}
          </ol>

          {playing && active ? (
            <p className="audio-overview__now muted text-xs">
              Şimdi: {active.name}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
