import { useEffect, useRef, useState, type FormEvent } from 'react'
import { askAboutSelection } from '@/lib/api'
import { friendlyAiError } from '@/lib/errors'
import StudyMarkdown from '@/components/StudyMarkdown'
import type { PdfSelectionPayload } from '@/components/PdfViewer'

type Props = {
  chapterId: string
  chapterTitle: string
  payload: PdfSelectionPayload | null
  mode: 'ask' | 'summarize' | 'explain' | null
  onClose: () => void
}

const MODE_Q: Record<'ask' | 'summarize' | 'explain', string> = {
  summarize:
    'Seçili pasajı kısa ve net özetle. Madde işaretleri kullan; gereksiz uzatma.',
  explain:
    'Seçili pasajı bir öğrenciye açıkla: tanım, neden önemli, 1 günlük hayat benzetmesi.',
  ask: 'Seçili pasaj hakkında net ve öğretici bir açıklama yap. Anlaşılmayan noktaları aç.',
}

const REQUEST_TIMEOUT_MS = 90_000

/** Floating / panel AI reply for PDF text selection. */
export default function PdfAiPanel({
  chapterId,
  chapterTitle,
  payload,
  mode,
  onClose,
}: Props) {
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([])

  // Don't re-fire / cancel when book title or chapter id arrives later.
  const metaRef = useRef({ chapterId, chapterTitle })
  metaRef.current = { chapterId, chapterTitle }

  const selectionKey = payload
    ? `${payload.page}::${payload.selectedText}`
    : ''

  useEffect(() => {
    if (!payload || !mode) return
    setAnswer(null)
    setError(null)
    setHistory([])
    setQuestion('')

    if (mode === 'ask') return

    let cancelled = false
    setLoading(true)

    const timed = Promise.race([
      askAboutSelection({
        chapterId: metaRef.current.chapterId,
        chapterTitle: metaRef.current.chapterTitle,
        selectedText: payload.selectedText,
        precedingContext: payload.precedingContext,
        followingContext: payload.followingContext,
        question: MODE_Q[mode],
        history: [],
      }),
      new Promise<string>((_, reject) => {
        window.setTimeout(() => {
          reject(new Error('Yanıt zaman aşımına uğradı. Tekrar dene.'))
        }, REQUEST_TIMEOUT_MS)
      }),
    ])

    void timed
      .then((text) => {
        if (cancelled) return
        const trimmed = text.trim()
        if (!trimmed) {
          setError('AI boş yanıt döndü. Tekrar dene.')
          return
        }
        setAnswer(trimmed)
        setHistory([
          { role: 'user', content: MODE_Q[mode] },
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
    // Only re-run when selection text/page or mode changes — not chapter meta.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectionKey, mode])

  async function sendAsk(e: FormEvent) {
    e.preventDefault()
    if (!payload || !question.trim() || loading) return
    setLoading(true)
    setError(null)
    const q = question.trim()
    setQuestion('')
    try {
      const text = await askAboutSelection({
        chapterId: metaRef.current.chapterId,
        chapterTitle: metaRef.current.chapterTitle,
        selectedText: payload.selectedText,
        precedingContext: payload.precedingContext,
        followingContext: payload.followingContext,
        question: q,
        history,
      })
      const trimmed = text.trim()
      if (!trimmed) {
        setError('AI boş yanıt döndü. Tekrar dene.')
        return
      }
      setAnswer(trimmed)
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

  if (!payload || !mode) return null

  return (
    <div className="pdf-ai-panel surface-panel">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="section-label mb-0.5">
            {mode === 'summarize'
              ? 'PDF özeti'
              : mode === 'explain'
                ? 'PDF açıklama'
                : 'PDF · AI’ya sor'}
          </p>
          <p className="muted text-[11px]">s. {payload.page}</p>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          Kapat
        </button>
      </div>

      <blockquote className="pdf-ai-panel__quote">
        {payload.selectedText.slice(0, 280)}
        {payload.selectedText.length > 280 ? '…' : ''}
      </blockquote>

      {mode === 'ask' && (
        <form onSubmit={(e) => void sendAsk(e)} className="mt-3 flex gap-2">
          <input
            className="field flex-1 text-sm"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ne sormak istersin?"
            autoFocus
          />
          <button
            type="submit"
            className="btn-primary shrink-0"
            disabled={loading || !question.trim()}
          >
            Gönder
          </button>
        </form>
      )}

      {loading && <p className="muted mt-3 text-sm">Düşünüyor…</p>}
      {error && <div className="alert-error mt-3">{error}</div>}
      {answer && (
        <div className="pdf-ai-panel__answer prose study-textbook mt-3 max-w-none text-sm">
          <StudyMarkdown markdown={answer} />
        </div>
      )}
    </div>
  )
}
