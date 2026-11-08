import { useEffect, useRef, useState } from 'react'
import { askAboutSelection } from '@/lib/api'
import { saveChapterExchange } from '@/lib/chapterMessages'
import type { LessonAskContext } from '@/lib/mindmapLesson/askContext'
import {
  createBrowserSpeechSession,
  isBrowserSpeechRecognitionSupported,
  type BrowserSpeechSession,
  type SpeechRecStatus,
} from '@/lib/browserSpeechRecognition'
import {
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  speakText,
  stopSpeech,
  toLectureSpeechText,
} from '@/lib/tts'
import LessonWaitMood from '@/components/LessonWaitMood'

type Turn = { role: 'user' | 'assistant'; content: string }

type Props = {
  open: boolean
  chapterId: string
  chapterTitle: string
  context: LessonAskContext | null
  onResume: () => void
}

/**
 * Multi-turn teacher Q&A while the lesson audio is paused mid-segment.
 */
export default function LessonAskPanel({
  open,
  chapterId,
  chapterTitle,
  context,
  onResume,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [micStatus, setMicStatus] = useState<SpeechRecStatus>(
    isBrowserSpeechRecognitionSupported() ? 'idle' : 'unsupported',
  )
  const [interim, setInterim] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const sessionKeyRef = useRef('')
  /** False after "Derse devam" — blocks late answers from starting TTS */
  const voiceAllowedRef = useRef(true)
  const askGenRef = useRef(0)
  const speechRef = useRef<BrowserSpeechSession | null>(null)
  const draftBaseRef = useRef('')

  // New interrupt session when panel opens on a (possibly new) segment
  useEffect(() => {
    if (!open) return
    voiceAllowedRef.current = true
    const key = `${context?.segmentTitle || ''}::${context?.selectionQuote || ''}`
    if (sessionKeyRef.current !== key) {
      sessionKeyRef.current = key
      askGenRef.current += 1
      setTurns([])
      setDraft('')
      setError(null)
      setInterim('')
      stopSpeech()
      setSpeaking(false)
      speechRef.current?.abort()
      setMicStatus(
        isBrowserSpeechRecognitionSupported() ? 'idle' : 'unsupported',
      )
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [open, context?.segmentTitle, context?.selectionQuote])

  useEffect(() => {
    if (!open) {
      voiceAllowedRef.current = false
      askGenRef.current += 1
      stopSpeech()
      setSpeaking(false)
      speechRef.current?.abort()
      setMicStatus((s) => (s === 'unsupported' ? s : 'idle'))
      setInterim('')
    } else {
      voiceAllowedRef.current = true
    }
  }, [open])

  useEffect(() => {
    return () => {
      speechRef.current?.abort()
      speechRef.current = null
    }
  }, [])

  // Escape / anytime exit back to lesson narration
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleResume()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [turns, busy])

  function stopMic() {
    speechRef.current?.stop()
    setInterim('')
    setMicStatus((s) => (s === 'unsupported' ? s : 'idle'))
  }

  function toggleMic() {
    if (busy || !context || !chapterId) return
    if (micStatus === 'unsupported') {
      setError(
        'Bu tarayıcıda sesle yazma yok. Chrome veya Edge dene; soruyu yazabilirsin.',
      )
      return
    }
    if (micStatus === 'listening') {
      stopMic()
      return
    }

    stopSpeech()
    setSpeaking(false)
    setError(null)
    draftBaseRef.current = draft.replace(/\s+$/, '')
    setInterim('')

    speechRef.current?.abort()
    const session = createBrowserSpeechSession({
      onStatus: (s) => setMicStatus(s),
      onInterim: (t) => {
        setInterim(t)
        const base = draftBaseRef.current
        setDraft(base ? `${base} ${t}`.trim() : t)
      },
      onFinal: (t) => {
        const base = draftBaseRef.current
        const next = base ? `${base} ${t}`.trim() : t
        draftBaseRef.current = next
        setDraft(next)
        setInterim('')
      },
      onErrorMessage: (msg) => setError(msg),
    })
    if (!session) {
      setMicStatus('unsupported')
      setError('Ses tanıma desteklenmiyor.')
      return
    }
    speechRef.current = session
    session.start()
  }

  async function submit() {
    const q = draft.replace(/\s+/g, ' ').trim()
    if (!q || busy || !context || !chapterId) return
    stopMic()
    setDraft('')
    setError(null)
    stopSpeech()
    setSpeaking(false)

    const history = turns.map((t) => ({ role: t.role, content: t.content }))
    setTurns((prev) => [...prev, { role: 'user', content: q }])
    setBusy(true)
    const gen = ++askGenRef.current
    try {
      const answer = await askAboutSelection({
        chapterId,
        chapterTitle,
        selectedText: context.selectedText,
        precedingContext: context.precedingContext,
        followingContext: context.followingContext,
        question: q,
        history,
        answerFormat: 'lecture',
      })
      if (gen !== askGenRef.current || !voiceAllowedRef.current) return

      const spoken = toLectureSpeechText(answer) || answer.trim()
      setTurns((prev) => [...prev, { role: 'assistant', content: spoken }])
      void saveChapterExchange({
        chapterId,
        question: q,
        answer: spoken,
        selectionQuote: context.selectionQuote,
      })
      if (!voiceAllowedRef.current || gen !== askGenRef.current) return
      speakText(spoken, {
        rate: getStoredRate(),
        voiceUri: getStoredVoiceUri(),
        lang: getStoredLang(),
        onStatus: (s) => {
          if (!voiceAllowedRef.current) {
            stopSpeech()
            setSpeaking(false)
            return
          }
          setSpeaking(s === 'speaking' || s === 'paused')
        },
        onEnd: () => setSpeaking(false),
      })
    } catch (err) {
      if (gen !== askGenRef.current || !voiceAllowedRef.current) return
      console.error('[lesson ask]', err)
      setError(
        err instanceof Error ? err.message : 'Cevap alınamadı, tekrar deneyin',
      )
      setTurns((prev) =>
        prev[prev.length - 1]?.role === 'user' ? prev.slice(0, -1) : prev,
      )
      setDraft(q)
    } finally {
      if (gen === askGenRef.current) setBusy(false)
    }
  }

  function handleResume() {
    voiceAllowedRef.current = false
    askGenRef.current += 1
    stopMic()
    stopSpeech()
    setSpeaking(false)
    setBusy(false)
    setError(null)
    onResume()
  }

  if (!open) return null

  const listening = micStatus === 'listening'
  const displayValue = draft

  return (
    <div className="lesson-ask" role="dialog" aria-label="Derste soru sor">
      <div className="lesson-ask__head">
        <div>
          <p className="lesson-ask__kicker">Hocaya sor</p>
          <h3 className="lesson-ask__title">
            {context?.segmentTitle || 'Anlatım'}
          </h3>
        </div>
        <button
          type="button"
          className="lesson-ask__resume"
          onClick={handleResume}
          disabled={false}
          aria-busy={false}
        >
          Derse devam
        </button>
      </div>

      <p className="lesson-ask__hint">
        Anlatım durdu. Yazarak veya mikrofonla sor; hazır olunca derse kaldığın
        yerden devam et.
      </p>

      <div className="lesson-ask__thread" ref={listRef}>
        {turns.length === 0 && !busy ? (
          <p className="lesson-ask__empty">
            Örn. “Bunu günlük hayattan bir örnekle açıkla”
          </p>
        ) : null}
        {turns.map((t, i) => (
          <div
            key={`${i}-${t.role}`}
            className={`lesson-ask__bubble lesson-ask__bubble--${t.role}`}
          >
            <span className="lesson-ask__who">
              {t.role === 'user' ? 'Sen' : 'Hoca'}
            </span>
            <p>{t.content}</p>
          </div>
        ))}
        {busy ? (
          <LessonWaitMood kind="thinking" size="compact" className="lesson-ask__wait" />
        ) : null}
      </div>

      {error ? (
        <p className="lesson-ask__error" role="alert">
          {error}
        </p>
      ) : null}

      {listening ? (
        <LessonWaitMood
          kind="speaking"
          size="compact"
          className="lesson-ask__wait"
          title="Seni dinliyor"
          detail={
            interim
              ? `“${interim}”`
              : 'Konuş, bitince mikrofona bas veya Gönder’e tıkla'
          }
        />
      ) : null}

      <div className="lesson-ask__composer">
        <button
          type="button"
          className={`lesson-ask__mic${listening ? ' lesson-ask__mic--on' : ''}`}
          disabled={busy || !context || !chapterId}
          aria-pressed={listening}
          aria-label={listening ? 'Dinlemeyi durdur' : 'Sesle sor'}
          title={
            micStatus === 'unsupported'
              ? 'Bu tarayıcıda ses tanıma yok'
              : listening
                ? 'Durdur'
                : 'Mikrofon (Türkçe)'
          }
          onClick={toggleMic}
        >
          {listening ? '◼' : '🎤'}
        </button>
        <textarea
          ref={inputRef}
          className="lesson-ask__input"
          rows={2}
          value={displayValue}
          disabled={busy || !context || !chapterId}
          placeholder={
            listening ? 'Konuşuyorun…' : 'Sorunu yaz veya mikrofonla söyle…'
          }
          onChange={(e) => {
            setDraft(e.target.value)
            draftBaseRef.current = e.target.value
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <button
          type="button"
          className="lesson-ask__send"
          disabled={busy || !draft.trim() || !context || !chapterId}
          onClick={() => void submit()}
        >
          Gönder
        </button>
      </div>

      {speaking ? (
        <button
          type="button"
          className="lesson-ask__stop-voice"
          onClick={() => {
            stopSpeech()
            setSpeaking(false)
          }}
        >
          Okumayı durdur
        </button>
      ) : null}
    </div>
  )
}
