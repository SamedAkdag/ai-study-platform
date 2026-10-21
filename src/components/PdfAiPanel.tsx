import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { askAboutSelection } from '@/lib/api'
import { friendlyAiError } from '@/lib/errors'
import {
  findRelatedPassages,
  type PageSource,
} from '@/lib/sourceLookup'
import StudyMarkdown from '@/components/StudyMarkdown'
import type { PdfSelectionPayload } from '@/components/PdfViewer'

type Props = {
  chapterId: string
  chapterTitle: string
  payload: PdfSelectionPayload | null
  mode: 'ask' | 'summarize' | 'explain' | null
  onClose: () => void
  pageSources?: PageSource[] | null
  onJumpPage?: (page: number) => void
  /** Seçimin bittiği yere AI kartı ekle. */
  onSaveToBook?: (body: string, question?: string) => void | Promise<void>
}

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const MODE_Q: Record<'ask' | 'summarize' | 'explain', string> = {
  summarize:
    'Seçili pasajı kısa ve net özetle. Madde işaretleri kullan; gereksiz uzatma.',
  explain:
    'Seçili pasajı bir öğrenciye açıkla: tanım, neden önemli, 1 günlük hayat benzetmesi.',
  ask: 'Seçili pasaj hakkında net ve öğretici bir açıklama yap. Anlaşılmayan noktaları aç.',
}

const MODE_Q_FIGURE: Record<'ask' | 'summarize' | 'explain', string> = {
  summarize:
    'Seçili grafiği / şekli kısa özetle: neyi gösteriyor, ana eğilim, 2–4 madde.',
  explain:
    'Seçili grafiği / şekli bir öğrenciye açıkla: eksenler, birimler, eğri/çubuk anlamı, neden önemli, 1 benzetme.',
  ask: 'Seçili grafiği / şekli incele ve öğretici bir açıklama yap. Okuyamadığın değeri uydurma.',
}

const SYNTH_PROMPT = `Aşağıdaki sohbeti (ilk anlatım + sonraki soru-cevaplar) tek bir ders notuna dönüştür.
Kurallar:
- Tekrarları birleştir; çelişki varsa en net / görüntüye dayalı olanı seç.
- Markdown: kısa başlıklar, maddeler, mümkünse 1 küçük tablo.
- Kaynakta / görüntüde olmayanı uydurma.
- Öğrencinin kitaba ekleyeceği nihai not olsun; sohbet üslubu kullanma.`

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

/** PDF seçim AI paneli — sohbet + isteğe bağlı nihai not. */
export default function PdfAiPanel({
  chapterId,
  chapterTitle,
  payload,
  mode,
  onClose,
  pageSources = null,
  onJumpPage,
  onSaveToBook,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [synthLoading, setSynthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const metaRef = useRef({ chapterId, chapterTitle })
  metaRef.current = { chapterId, chapterTitle }

  const isFigure = payload?.kind === 'region' && !!payload.imageDataUrl
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

  const followUpCount = history.filter((h) => h.role === 'user').length
  const canSynth = history.some((h) => h.role === 'assistant')

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [history, draftNote, loading])

  useEffect(() => {
    if (!payload || !mode) return
    setError(null)
    setSaving(false)
    setSaveMsg(null)
    setHistory([])
    setQuestion('')
    setDraftNote(null)

    // ask: kullanıcı ilk soruyu yazar; summarize/explain otomatik başlar
    if (mode === 'ask') return

    let cancelled = false
    setLoading(true)

    const prompts = payload.kind === 'region' ? MODE_Q_FIGURE : MODE_Q
    const isRegion = payload.kind === 'region'
    const opener = prompts[mode]

    void askTimed({
      chapterId: metaRef.current.chapterId,
      chapterTitle: metaRef.current.chapterTitle,
      selectedText: isRegion ? '' : payload.selectedText,
      precedingContext: payload.precedingContext,
      followingContext: payload.followingContext,
      question: opener,
      history: [],
      imageDataUrl: payload.imageDataUrl,
      requireImage: isRegion,
    })
      .then((text) => {
        if (cancelled) return
        const trimmed = text.trim()
        if (!trimmed) {
          setError('AI boş yanıt döndü. Tekrar dene.')
          return
        }
        setHistory([
          { role: 'user', content: opener },
          { role: 'assistant', content: trimmed },
        ])
      })
      .catch((err) => {
        if (cancelled) return
        setError(friendlyAiError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectionKey, mode])

  function selectionArgs() {
    if (!payload) return null
    const isRegion = payload.kind === 'region'
    return {
      chapterId: metaRef.current.chapterId,
      chapterTitle: metaRef.current.chapterTitle,
      selectedText: isRegion ? '' : payload.selectedText,
      precedingContext: payload.precedingContext,
      followingContext: payload.followingContext,
      imageDataUrl: payload.imageDataUrl,
      requireImage: isRegion,
    }
  }

  async function sendAsk(e: FormEvent) {
    e.preventDefault()
    const base = selectionArgs()
    if (!payload || !base || !question.trim() || loading) return
    setLoading(true)
    setError(null)
    setSaveMsg(null)
    const q = question.trim()
    setQuestion('')
    try {
      const text = await askTimed({
        ...base,
        question: q,
        history,
      })
      const trimmed = text.trim()
      if (!trimmed) {
        setError('AI boş yanıt döndü. Tekrar dene.')
        return
      }
      setHistory((h) => [
        ...h,
        { role: 'user', content: q },
        { role: 'assistant', content: trimmed },
      ])
    } catch (err) {
      setError(friendlyAiError(err))
    } finally {
      setLoading(false)
    }
  }

  async function synthesizeNote() {
    const base = selectionArgs()
    if (!payload || !base || !canSynth || synthLoading) return
    setSynthLoading(true)
    setError(null)
    setSaveMsg(null)
    try {
      const transcript = history
        .map((t) =>
          t.role === 'user' ? `Öğrenci: ${t.content}` : `Asistan: ${t.content}`,
        )
        .join('\n\n')
      const text = await askTimed({
        ...base,
        question: `${SYNTH_PROMPT}\n\n--- SOHBET ---\n${transcript}`,
        history: [],
      })
      const trimmed = text.trim()
      if (!trimmed) {
        setError('Nihai not boş geldi. Tekrar dene.')
        return
      }
      setDraftNote(trimmed)
    } catch (err) {
      setError(friendlyAiError(err))
    } finally {
      setSynthLoading(false)
    }
  }

  function saveBody(body: string, questionLabel?: string) {
    if (!onSaveToBook) return
    setSaving(true)
    setSaveMsg(null)
    void Promise.resolve(onSaveToBook(body, questionLabel))
      .then(() => {
        setSaveMsg('Seçimin altına eklendi')
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

  const title = isFigure
    ? mode === 'summarize'
      ? 'Grafik · sohbet'
      : mode === 'explain'
        ? 'Grafik · sohbet'
        : 'Grafik · AI’ya sor'
    : mode === 'summarize'
      ? 'PDF · sohbet'
      : mode === 'explain'
        ? 'PDF · sohbet'
        : 'PDF · AI’ya sor'

  return (
    <div className="pdf-ai-panel surface-panel">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="section-label mb-0.5">{title}</p>
          <p className="muted text-[11px]">
            s. {payload.page}
            {followUpCount > 1 ? ` · ${followUpCount} soru` : ''}
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          Kapat
        </button>
      </div>

      {isFigure && payload.imageDataUrl ? (
        <div className="pdf-ai-panel__figure">
          <img
            src={payload.imageDataUrl}
            alt="Seçilen grafik / şekil"
            className="pdf-ai-panel__figure-img"
          />
          {(payload.precedingContext || payload.followingContext) && (
            <p className="pdf-ai-panel__figure-ctx muted text-[11px]">
              {payload.precedingContext
                ? `Üst: “${payload.precedingContext.slice(0, 90)}${
                    payload.precedingContext.length > 90 ? '…' : ''
                  }”`
                : null}
              {payload.precedingContext && payload.followingContext
                ? ' · '
                : null}
              {payload.followingContext
                ? `Alt: “${payload.followingContext.slice(0, 90)}${
                    payload.followingContext.length > 90 ? '…' : ''
                  }”`
                : null}
            </p>
          )}
        </div>
      ) : (
        <blockquote className="pdf-ai-panel__quote">
          {payload.selectedText.slice(0, 280)}
          {payload.selectedText.length > 280 ? '…' : ''}
        </blockquote>
      )}

      <div className="pdf-ai-panel__chat" aria-live="polite">
        {history.map((turn, i) => (
          <div
            key={`${turn.role}-${i}`}
            className={`pdf-ai-panel__bubble pdf-ai-panel__bubble--${turn.role}`}
          >
            <p className="pdf-ai-panel__bubble-label">
              {turn.role === 'user' ? 'Sen' : 'Studium'}
            </p>
            {turn.role === 'assistant' ? (
              <div className="prose study-textbook max-w-none text-sm">
                <StudyMarkdown markdown={turn.content} />
              </div>
            ) : (
              <p className="pdf-ai-panel__bubble-text">{turn.content}</p>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {loading && <p className="muted mt-2 text-sm">Düşünüyor…</p>}
      {error && <div className="alert-error mt-2">{error}</div>}

      <form onSubmit={(e) => void sendAsk(e)} className="mt-3 flex gap-2">
        <input
          className="field flex-1 text-sm"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            history.length === 0 && mode === 'ask'
              ? 'Ne sormak istersin?'
              : 'Devam sorusu… (eksen, eğilim, örnek…)'
          }
          disabled={loading || synthLoading}
          autoFocus={mode === 'ask'}
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={loading || synthLoading || !question.trim()}
        >
          Gönder
        </button>
      </form>

      {canSynth && onSaveToBook ? (
        <div className="pdf-ai-panel__actions mt-3">
          {lastAssistant ? (
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={saving || loading || synthLoading}
              onClick={() => {
                const firstUser = history.find((h) => h.role === 'user')?.content
                saveBody(lastAssistant, firstUser)
              }}
            >
              Son yanıtı ekle
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={saving || loading || synthLoading}
            onClick={() => void synthesizeNote()}
          >
            {synthLoading
              ? 'Not hazırlanıyor…'
              : 'Konuşmadan ders notu üret'}
          </button>
          {saveMsg ? (
            <span className="muted text-[11px]">{saveMsg}</span>
          ) : null}
        </div>
      ) : null}

      {draftNote ? (
        <div className="pdf-ai-panel__draft mt-3">
          <p className="section-label mb-1.5">Nihai ders notu</p>
          <div className="prose study-textbook max-w-none text-sm">
            <StudyMarkdown markdown={draftNote} />
          </div>
          {onSaveToBook ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={saving}
                onClick={() =>
                  saveBody(
                    draftNote,
                    'Sohbetten üretilen ders notu',
                  )
                }
              >
                {saving ? 'Ekleniyor…' : 'Bu notu seçimin altına ekle'}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={synthLoading}
                onClick={() => void synthesizeNote()}
              >
                Yeniden üret
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

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
                    {hit.excerpt.slice(0, 160)}
                    {hit.excerpt.length > 160 ? '…' : ''}
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
