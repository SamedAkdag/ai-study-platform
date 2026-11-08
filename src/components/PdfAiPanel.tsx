import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { askAboutSelection } from '@/lib/api'
import { friendlyAiError } from '@/lib/errors'
import {
  findRelatedPassages,
  type PageSource,
} from '@/lib/sourceLookup'
import StudyMarkdown from '@/components/StudyMarkdown'
import LessonWaitMood from '@/components/LessonWaitMood'
import type { PdfSelectionPayload } from '@/components/PdfViewer'
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
import { getPdfAiAutoSpeak, setPdfAiAutoSpeak } from '@/lib/pdfSpeak'

type AiMode = 'ask' | 'summarize' | 'explain' | 'translate'

type Props = {
  chapterId: string
  chapterTitle: string
  payload: PdfSelectionPayload | null
  mode: AiMode | null
  onClose: () => void
  pageSources?: PageSource[] | null
  onJumpPage?: (page: number) => void
  onSaveToBook?: (body: string, question?: string) => void | Promise<void>
  seedQuestion?: string | null
}

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const MODE_Q: Record<AiMode, string> = {
  summarize:
    'Seçili pasajı 2–3 kısa cümleyle özetle. Madde işaretleri kullan; uzatma.',
  explain:
    'Seçili pasajı 2–3 cümlede açıkla: ne, neden önemli, 1 basit benzetme.',
  translate:
    'Seçili pasajı açık ve doğal Türkçeye çevir. Gerekirse 1 cümle not ekle.',
  ask: 'Seçili pasajı bir öğrenciye anlatır gibi yanıtla. Net, sıcak, 4–8 cümle.',
}

const MODE_Q_FIGURE: Record<AiMode, string> = {
  summarize:
    'Seçili grafiği / şekli 2–3 maddede özetle: neyi gösteriyor, ana eğilim.',
  explain:
    'Seçili grafiği / şekli kısaca açıkla: eksenler, birimler, neden önemli.',
  translate: 'Grafik / şekil üzerindeki metinleri Türkçeye çevir.',
  ask: 'Seçili grafiği / şekli bir öğrenciye anlatır gibi açıkla. Uydurma.',
}

const REQUEST_TIMEOUT_MS = 90_000

async function askTimed(
  input: Parameters<typeof askAboutSelection>[0],
): Promise<string> {
  return Promise.race([
    askAboutSelection(input),
    new Promise<string>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('Yanıt zaman aşımına uğradı. Tekrar dene.'))
      }, REQUEST_TIMEOUT_MS)
    }),
  ])
}

/** Shadow AI rail — Hocaya sor + TTS, never a modal. */
export default function PdfAiPanel({
  chapterId,
  chapterTitle,
  payload,
  mode,
  onClose,
  pageSources = null,
  onJumpPage,
  onSaveToBook,
  seedQuestion = null,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(() => getPdfAiAutoSpeak())
  const [micStatus, setMicStatus] = useState<SpeechRecStatus>(
    isBrowserSpeechRecognitionSupported() ? 'idle' : 'unsupported',
  )
  const [interim, setInterim] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<ChatTurn[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const speechRef = useRef<BrowserSpeechSession | null>(null)
  const voiceOkRef = useRef(true)
  const autoSpeakRef = useRef(autoSpeak)
  const askGenRef = useRef(0)
  autoSpeakRef.current = autoSpeak

  const metaRef = useRef({ chapterId, chapterTitle })
  metaRef.current = { chapterId, chapterTitle }

  const isFigure = payload?.kind === 'region' && !!payload.imageDataUrl
  const lectureMode = mode === 'ask'
  const selectionKey = payload
    ? `${payload.page}::${payload.kind || 'text'}::${
        payload.imageDataUrl
          ? payload.imageDataUrl.slice(0, 64)
          : payload.selectedText
      }`
    : ''

  const sourceHits = useMemo(() => {
    if (!payload || !pageSources?.length) return []
    if (payload.kind === 'region') return []
    return findRelatedPassages(pageSources, payload.selectedText, 3)
  }, [payload, pageSources])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [history, loading])

  useEffect(() => {
    voiceOkRef.current = true
    return () => {
      voiceOkRef.current = false
      askGenRef.current += 1
      stopSpeech()
      speechRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    threadRef.current = []
    setHistory([])
    stopSpeech()
    setSpeaking(false)
    speechRef.current?.abort()
    setInterim('')
  }, [selectionKey])

  function speakAnswer(text: string) {
    const spoken = toLectureSpeechText(text) || text.trim()
    if (!spoken) return
    speakText(spoken, {
      rate: getStoredRate(),
      voiceUri: getStoredVoiceUri(),
      lang: getStoredLang(),
      onStatus: (s) => {
        if (!voiceOkRef.current) {
          stopSpeech()
          setSpeaking(false)
          return
        }
        setSpeaking(s === 'speaking' || s === 'paused')
      },
      onEnd: () => setSpeaking(false),
    })
  }

  function stopVoice() {
    stopSpeech()
    setSpeaking(false)
  }

  function finishAnswer(raw: string, prior: ChatTurn[], opener: string) {
    const trimmed = raw.trim()
    if (!trimmed) {
      setError('AI boş yanıt döndü. Tekrar dene.')
      return
    }
    const content =
      lectureMode || mode === 'explain'
        ? toLectureSpeechText(trimmed) || trimmed
        : trimmed
    const next: ChatTurn[] = [
      ...prior,
      { role: 'user', content: opener },
      { role: 'assistant', content },
    ]
    threadRef.current = next
    setHistory(next)
    if (
      autoSpeakRef.current &&
      (lectureMode || mode === 'explain' || mode === 'summarize')
    ) {
      speakAnswer(content)
    }
  }

  useEffect(() => {
    if (!payload || !mode) return
    setError(null)
    setSaving(false)
    setSaveMsg(null)
    setQuestion('')

    if (mode === 'ask' && !seedQuestion) {
      window.setTimeout(() => inputRef.current?.focus(), 40)
      return
    }

    let cancelled = false
    const gen = ++askGenRef.current
    setLoading(true)
    const prompts = isFigure ? MODE_Q_FIGURE : MODE_Q
    const opener = seedQuestion?.trim() || prompts[mode]
    const prior = threadRef.current

    void askTimed({
      chapterId: metaRef.current.chapterId,
      chapterTitle: metaRef.current.chapterTitle,
      selectedText: isFigure ? '' : payload.selectedText,
      precedingContext: payload.precedingContext,
      followingContext: payload.followingContext,
      question: opener,
      history: prior,
      imageDataUrl: payload.imageDataUrl,
      requireImage: isFigure,
      answerFormat: mode === 'ask' ? 'lecture' : 'notes',
    })
      .then((text) => {
        if (cancelled || gen !== askGenRef.current) return
        finishAnswer(text, prior, opener)
      })
      .catch((err) => {
        if (!cancelled && gen === askGenRef.current) {
          setError(friendlyAiError(err))
        }
      })
      .finally(() => {
        if (!cancelled && gen === askGenRef.current) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, mode, seedQuestion])

  function selectionArgs() {
    if (!payload) return null
    return {
      chapterId: metaRef.current.chapterId,
      chapterTitle: metaRef.current.chapterTitle,
      selectedText: isFigure ? '' : payload.selectedText,
      precedingContext: payload.precedingContext,
      followingContext: payload.followingContext,
      imageDataUrl: payload.imageDataUrl,
      requireImage: isFigure,
    }
  }

  async function sendAsk(e?: FormEvent, override?: string) {
    e?.preventDefault()
    const base = selectionArgs()
    const q = (override ?? question).trim()
    if (!payload || !base || !q || loading) return
    setLoading(true)
    setError(null)
    setSaveMsg(null)
    setQuestion('')
    const gen = ++askGenRef.current
    const prior = threadRef.current
    try {
      const text = await askTimed({
        ...base,
        question: q,
        history: prior,
        answerFormat: lectureMode ? 'lecture' : 'notes',
      })
      if (gen !== askGenRef.current) return
      finishAnswer(text, prior, q)
    } catch (err) {
      if (gen === askGenRef.current) setError(friendlyAiError(err))
    } finally {
      if (gen === askGenRef.current) setLoading(false)
    }
  }

  function stopMic() {
    speechRef.current?.abort()
    speechRef.current = null
    setInterim('')
    setMicStatus((s) => (s === 'unsupported' ? s : 'idle'))
  }

  function toggleMic() {
    if (loading) return
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
    stopVoice()
    setError(null)
    const base = question.replace(/\s+$/, '')
    setInterim('')
    speechRef.current?.abort()
    const session = createBrowserSpeechSession({
      onStatus: setMicStatus,
      onInterim: (t) => {
        setInterim(t)
        setQuestion(base ? `${base} ${t}`.trim() : t)
      },
      onFinal: (t) => {
        const next = base ? `${base} ${t}`.trim() : t
        setQuestion(next)
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

  function newChat() {
    askGenRef.current += 1
    threadRef.current = []
    setHistory([])
    setError(null)
    setSaveMsg(null)
    setQuestion('')
    stopVoice()
    stopMic()
    inputRef.current?.focus()
  }

  function handleClose() {
    voiceOkRef.current = false
    askGenRef.current += 1
    stopVoice()
    stopMic()
    onClose()
  }

  function saveBody(body: string, questionLabel?: string) {
    if (!onSaveToBook) return
    setSaving(true)
    setSaveMsg(null)
    void Promise.resolve(onSaveToBook(body, questionLabel))
      .then(() => {
        setSaveMsg('Sayfana eklendi')
        setSaving(false)
      })
      .catch((err) => {
        setSaveMsg(friendlyAiError(err))
        setSaving(false)
      })
  }

  if (!payload || !mode) return null

  const lastAssistant = [...history]
    .reverse()
    .find((h) => h.role === 'assistant')?.content

  const title =
    mode === 'summarize'
      ? 'Özet'
      : mode === 'explain'
        ? 'Açıkla'
        : mode === 'translate'
          ? 'Çevir'
          : "AI'a sor"

  const listening = micStatus === 'listening'

  return (
    <div className="pdf-ai-panel pdf-ai-panel--shadow surface-panel">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="section-label mb-0.5">{title}</p>
          <p className="muted text-[11px]">
            s. {payload.page}
            {history.length > 0 ? ` · ${Math.ceil(history.length / 2)} tur` : ''}
            {speaking ? ' · okunuyor' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={newChat}
            title="Thread’i temizle"
          >
            Yeni sohbet
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={handleClose}
          >
            Kapat
          </button>
        </div>
      </div>

      {isFigure && payload.imageDataUrl ? (
        <div className="pdf-ai-panel__figure">
          <img
            src={payload.imageDataUrl}
            alt="Seçilen grafik / şekil"
            className="pdf-ai-panel__figure-img"
          />
        </div>
      ) : (
        <blockquote className="pdf-ai-panel__quote">
          {payload.selectedText.slice(0, 180)}
          {payload.selectedText.length > 180 ? '…' : ''}
        </blockquote>
      )}

      {lectureMode && history.length === 0 && !loading ? (
        <p className="muted text-xs mb-2">
          Yaz veya mikrofonla sor
          {autoSpeak ? ' — yanıt otomatik sesli okunur.' : '.'}
        </p>
      ) : null}

      <div className="pdf-ai-panel__chat" aria-live="polite">
        {history.map((turn, i) => (
          <div
            key={`${turn.role}-${i}`}
            className={`pdf-ai-panel__bubble pdf-ai-panel__bubble--${turn.role}`}
          >
            <div className="pdf-ai-panel__bubble-head">
              <p className="pdf-ai-panel__bubble-label">
                {turn.role === 'user' ? 'Sen' : lectureMode ? 'Hoca' : 'Studium'}
              </p>
              {turn.role === 'assistant' ? (
                <button
                  type="button"
                  className="pdf-ai-panel__speak"
                  title="Sesli oku"
                  onClick={() => speakAnswer(turn.content)}
                >
                  🔊
                </button>
              ) : null}
            </div>
            {turn.role === 'assistant' ? (
              <div className="prose study-textbook max-w-none text-sm pdf-ai-panel__answer">
                <StudyMarkdown markdown={turn.content} />
              </div>
            ) : (
              <p className="pdf-ai-panel__bubble-text">{turn.content}</p>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {loading ? (
        <div className="mt-2">
          <LessonWaitMood kind="thinking" size="compact" />
        </div>
      ) : null}
      {listening ? (
        <div className="mt-2">
          <LessonWaitMood
            kind="speaking"
            size="compact"
            title="Seni dinliyor"
            detail={interim ? `“${interim}”` : 'Konuş, bitince mikrofona bas'}
          />
        </div>
      ) : null}
      {error ? <div className="alert-error mt-2">{error}</div> : null}

      <form
        onSubmit={(e) => void sendAsk(e)}
        className="mt-3 flex gap-2 items-center"
      >
        <button
          type="button"
          className={`pdf-ai-panel__mic${listening ? ' is-on' : ''}`}
          disabled={loading}
          aria-pressed={listening}
          aria-label={listening ? 'Dinlemeyi durdur' : 'Sesle sor'}
          title={
            micStatus === 'unsupported'
              ? 'Bu tarayıcıda ses tanıma yok'
              : listening
                ? 'Durdur'
                : 'Mikrofon'
          }
          onClick={toggleMic}
        >
          {listening ? '◼' : '🎤'}
        </button>
        <input
          ref={inputRef}
          className="field flex-1 text-sm"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            listening
              ? 'Konuşuyorsun…'
              : history.length === 0 && mode === 'ask'
                ? 'Ne sormak istersin?'
                : 'Devam et…'
          }
          disabled={loading}
          autoFocus={mode === 'ask'}
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={loading || !question.trim()}
        >
          Gönder
        </button>
      </form>

      <label className="pdf-ai-panel__auto">
        <input
          type="checkbox"
          checked={autoSpeak}
          onChange={(e) => {
            const on = e.target.checked
            setAutoSpeak(on)
            setPdfAiAutoSpeak(on)
            if (!on) stopVoice()
          }}
        />
        Yanıtı otomatik sesli oku
      </label>

      <div className="pdf-ai-panel__actions mt-3">
        {lastAssistant && onSaveToBook ? (
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={saving || loading}
            onClick={() => {
              const firstUser = history.find((h) => h.role === 'user')?.content
              saveBody(lastAssistant, firstUser)
            }}
          >
            {saving ? 'Ekleniyor…' : 'Karta dönüştür'}
          </button>
        ) : null}
        {lastAssistant ? (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={loading}
            onClick={() =>
              speaking ? stopVoice() : speakAnswer(lastAssistant)
            }
          >
            {speaking ? 'Durdur' : 'Sesli oku'}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={handleClose}
        >
          Kapat
        </button>
        {saveMsg ? (
          <span className="muted text-[11px]">{saveMsg}</span>
        ) : null}
      </div>

      {sourceHits.length > 0 ? (
        <div className="pdf-ai-panel__sources">
          <p className="section-label mb-1.5">Kaynak pasajlar</p>
          <ul>
            {sourceHits.map((hit) => (
              <li key={`${hit.page}-${hit.score}`}>
                <button
                  type="button"
                  className="pdf-ai-panel__source"
                  onClick={() => onJumpPage?.(hit.page)}
                >
                  <span className="pdf-ai-panel__source-page">
                    s. {hit.page}
                  </span>
                  <span className="pdf-ai-panel__source-ex">
                    {hit.excerpt.slice(0, 120)}
                    {hit.excerpt.length > 120 ? '…' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
