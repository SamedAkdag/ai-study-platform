import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_TTS_LANG,
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  isTtsSupported,
  listVoices,
  markdownToSpeechText,
  pauseSpeech,
  pickVoice,
  resumeSpeech,
  setStoredLang,
  setStoredRate,
  setStoredVoiceUri,
  speakText,
  stopSpeech,
  textFromSelection,
  voicesForLang,
  voiceMatchesLang,
  langPrefix,
  type TtsStatus,
} from '@/lib/tts'

export function useTts() {
  const [supported] = useState(() => isTtsSupported())
  const [status, setStatus] = useState<TtsStatus>(
    supported ? 'idle' : 'unsupported',
  )
  const [rate, setRateState] = useState(getStoredRate)
  const [lang, setLangState] = useState(getStoredLang)
  const [voiceUri, setVoiceUriState] = useState(getStoredVoiceUri)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [chunkInfo, setChunkInfo] = useState<{
    index: number
    total: number
    text: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    const load = () => {
      const all = listVoices()
      setVoices(all)
      // If Turkish selected but saved voice is English (old bug), clear to TR match
      if (langPrefix(lang) === 'tr' && all.length) {
        const current = all.find((v) => v.voiceURI === voiceUri)
        const currentIsTr = current
          ? voiceMatchesLang(current, 'tr-TR')
          : false
        if (!voiceUri || !currentIsTr) {
          const tr = pickVoice(all, undefined, 'tr-TR')
          if (tr) {
            setVoiceUriState(tr.voiceURI)
            setStoredVoiceUri(tr.voiceURI)
          } else {
            setVoiceUriState('')
            setStoredVoiceUri('')
          }
        }
      }
    }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
      stopSpeech()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebind on mount/support
  }, [supported])

  const setRate = useCallback((r: number) => {
    const next = Math.min(1.6, Math.max(0.6, r))
    setRateState(next)
    setStoredRate(next)
  }, [])

  const setLang = useCallback((nextLang: string) => {
    const langCode = nextLang || DEFAULT_TTS_LANG
    setLangState(langCode)
    setStoredLang(langCode)
    const pool = voicesForLang(listVoices(), langCode)
    const nextVoice = pickVoice(pool.length ? pool : listVoices(), undefined, langCode)
    const uri = nextVoice?.voiceURI || ''
    setVoiceUriState(uri)
    setStoredVoiceUri(uri)
  }, [])

  const setVoiceUri = useCallback((uri: string) => {
    setVoiceUriState(uri)
    setStoredVoiceUri(uri)
  }, [])

  const filteredVoices = useMemo(
    () => voicesForLang(voices, lang),
    [voices, lang],
  )

  const speakPlain = useCallback(
    (plain: string) => {
      setError(null)
      speakText(plain, {
        rate,
        voiceUri,
        lang,
        onStatus: setStatus,
        onChunk: (index, total, text) => setChunkInfo({ index, total, text }),
        onEnd: () => setChunkInfo(null),
        onError: (m) => {
          setError(m)
          setStatus('idle')
        },
      })
    },
    [rate, voiceUri, lang],
  )

  const speakMarkdown = useCallback(
    (md: string) => {
      speakPlain(markdownToSpeechText(md))
    },
    [speakPlain],
  )

  const speakFromSelection = useCallback(
    (md: string, selected: string) => {
      const full = markdownToSpeechText(md)
      speakPlain(textFromSelection(full, selected))
    },
    [speakPlain],
  )

  const pause = useCallback(() => {
    pauseSpeech()
    setStatus('paused')
  }, [])

  const resume = useCallback(() => {
    resumeSpeech()
    setStatus('speaking')
  }, [])

  const stop = useCallback(() => {
    stopSpeech()
    setStatus('idle')
    setChunkInfo(null)
  }, [])

  const preferredVoice = pickVoice(voices, voiceUri, lang)

  return {
    supported,
    status,
    rate,
    setRate,
    lang,
    setLang,
    voiceUri,
    setVoiceUri,
    voices: filteredVoices,
    allVoices: voices,
    preferredVoice,
    chunkInfo,
    error,
    speakMarkdown,
    speakFromSelection,
    speakPlain,
    pause,
    resume,
    stop,
  }
}
