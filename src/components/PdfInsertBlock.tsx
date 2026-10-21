import { useEffect, useRef, useState, type FormEvent } from 'react'
import StudyMarkdown from '@/components/StudyMarkdown'
import { askAboutSelection } from '@/lib/api'
import { friendlyAiError } from '@/lib/errors'
import {
  annotationAiLabel,
  annotationKindLabel,
  type PdfAnnotation,
  type PdfAiMode,
} from '@/lib/pdfAnnotations'
import {
  pdfTextStyleToReact,
  type PdfTextStyle,
} from '@/lib/pdfTextStyle'
import type { PdfSelectionPayload } from '@/types/pdfSelection'

const MODE_Q: Record<PdfAiMode, string> = {
  summarize:
    'Seçili pasajı kısa ve net özetle. Madde işaretleri kullan; gereksiz uzatma.',
  explain:
    'Seçili pasajı bir öğrenciye açıkla: tanım, neden önemli, 1 günlük hayat benzetmesi.',
  ask: 'Seçili pasaj hakkında net ve öğretici bir açıklama yap.',
}

export type InsertDraft =
  | {
      kind: 'ai'
      mode: PdfAiMode
      payload: PdfSelectionPayload
      y: number
    }
  | {
      kind: 'note'
      payload: PdfSelectionPayload
      y: number
    }
  | {
      kind: 'replace'
      payload: PdfSelectionPayload
      y: number
    }

type Props = {
  annotation?: PdfAnnotation
  draft?: InsertDraft
  chapterId: string
  chapterTitle: string
  onDismissDraft?: () => void
  onCommitAi?: (input: {
    payload: PdfSelectionPayload
    mode: PdfAiMode
    question?: string
    body: string
    y: number
  }) => void
  onCommitNote?: (input: {
    payload: PdfSelectionPayload
    body: string
    y: number
  }) => void
  onCommitReplace?: (input: {
    payload: PdfSelectionPayload
    body: string
    y: number
  }) => void
  onRemove?: (id: string) => void
}

function matchClass(style?: PdfTextStyle | null) {
  return style ? ' pdf-insert--matched' : ''
}

/** In-flow book insert — sits between sliced PDF bands (opens real space). */
export default function PdfInsertBlock({
  annotation,
  draft,
  chapterId,
  chapterTitle,
  onDismissDraft,
  onCommitAi,
  onCommitNote,
  onCommitReplace,
  onRemove,
}: Props) {
  if (draft) {
    return (
      <DraftInsert
        draft={draft}
        chapterId={chapterId}
        chapterTitle={chapterTitle}
        onDismiss={onDismissDraft}
        onCommitAi={onCommitAi}
        onCommitNote={onCommitNote}
        onCommitReplace={onCommitReplace}
      />
    )
  }
  if (!annotation) return null

  const label =
    annotation.kind === 'ai'
      ? annotationAiLabel(annotation.aiMode)
      : annotationKindLabel(annotation.kind)
  const textStyle = annotation.textStyle
  const isReplace = annotation.kind === 'replace'

  return (
    <section
      className={`pdf-insert${matchClass(textStyle)}${
        annotation.kind === 'ai' ? ' pdf-insert--ai' : ''
      }${isReplace ? ' pdf-insert--replace' : ''}`}
      data-insert-id={annotation.id}
      style={pdfTextStyleToReact(textStyle)}
    >
      <header className="pdf-insert__head">
        <div>
          <p className="pdf-insert__label">
            {label}
            {textStyle ? (
              <span className="pdf-insert__style-badge" title="Seçilen PDF yazı stiline uyumlu">
                · PDF stili
              </span>
            ) : null}
          </p>
          {!isReplace ? (
            <p className="pdf-insert__quote">
              “…{annotation.quote.slice(0, 160)}
              {annotation.quote.length > 160 ? '…' : ''}”
            </p>
          ) : (
            <p className="pdf-insert__quote pdf-insert__quote--was">
              Eski: “…{annotation.quote.slice(0, 120)}
              {annotation.quote.length > 120 ? '…' : ''}”
            </p>
          )}
        </div>
        {onRemove ? (
          <button
            type="button"
            className="btn-ghost text-[11px]"
            onClick={() => onRemove(annotation.id)}
          >
            Kaldır
          </button>
        ) : null}
      </header>
      {annotation.question ? (
        <p className="pdf-insert__question">Soru · {annotation.question}</p>
      ) : null}
      {annotation.body ? (
        isReplace ? (
          <p className="pdf-insert__body pdf-insert__replace-text">{annotation.body}</p>
        ) : (
          <div className="pdf-insert__body prose study-textbook max-w-none text-sm">
            <StudyMarkdown markdown={annotation.body} />
          </div>
        )
      ) : (
        <p className="muted text-xs">İçerik yok.</p>
      )}
    </section>
  )
}

function DraftInsert({
  draft,
  chapterId,
  chapterTitle,
  onDismiss,
  onCommitAi,
  onCommitNote,
  onCommitReplace,
}: {
  draft: InsertDraft
  chapterId: string
  chapterTitle: string
  onDismiss?: () => void
  onCommitAi?: Props['onCommitAi']
  onCommitNote?: Props['onCommitNote']
  onCommitReplace?: Props['onCommitReplace']
}) {
  const [question, setQuestion] = useState('')
  const [askedQuestion, setAskedQuestion] = useState<string | undefined>()
  const [noteBody, setNoteBody] = useState('')
  const [replaceBody, setReplaceBody] = useState(draft.payload.selectedText)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const askedRef = useRef<string | null>(null)
  const textStyle = draft.payload.textStyle
  const shellStyle = pdfTextStyleToReact(textStyle)

  useEffect(() => {
    if (draft.kind !== 'ai' || draft.mode === 'ask') return
    const key = `${draft.mode}:${draft.payload.selectedText}`
    if (askedRef.current === key) return
    askedRef.current = key

    let cancelled = false
    setLoading(true)
    setError(null)
    void askAboutSelection({
      chapterId,
      chapterTitle,
      selectedText: draft.payload.selectedText,
      precedingContext: draft.payload.precedingContext,
      followingContext: draft.payload.followingContext,
      question: MODE_Q[draft.mode],
      history: [],
    })
      .then((text) => {
        if (cancelled) return
        const trimmed = text.trim()
        if (!trimmed) {
          setError('AI boş yanıt döndü.')
          return
        }
        setAnswer(trimmed)
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyAiError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [draft, chapterId, chapterTitle])

  if (draft.kind === 'replace') {
    return (
      <section
        className={`pdf-insert pdf-insert--draft pdf-insert--replace${matchClass(textStyle)}`}
        style={shellStyle}
      >
        <header className="pdf-insert__head">
          <p className="pdf-insert__label">
            Metni değiştir
            {textStyle ? (
              <span className="pdf-insert__style-badge">· PDF stili</span>
            ) : null}
          </p>
          <button type="button" className="btn-ghost text-[11px]" onClick={onDismiss}>
            Vazgeç
          </button>
        </header>
        <p className="pdf-insert__quote pdf-insert__quote--was">
          Seçilen: “…{draft.payload.selectedText.slice(0, 160)}
          {draft.payload.selectedText.length > 160 ? '…' : ''}”
        </p>
        <textarea
          className="field mt-2 text-sm pdf-insert__match-field"
          rows={3}
          autoFocus
          placeholder="Yeni metin…"
          value={replaceBody}
          onChange={(e) => setReplaceBody(e.target.value)}
        />
        <div className="pdf-insert__actions">
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={!replaceBody.trim()}
            onClick={() =>
              onCommitReplace?.({
                payload: draft.payload,
                body: replaceBody.trim(),
                y: draft.y,
              })
            }
          >
            Uygula
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={onDismiss}>
            Vazgeç
          </button>
        </div>
      </section>
    )
  }

  async function sendAsk(e: FormEvent) {
    e.preventDefault()
    if (draft.kind !== 'ai' || !question.trim() || loading) return
    setLoading(true)
    setError(null)
    const q = question.trim()
    try {
      const text = await askAboutSelection({
        chapterId,
        chapterTitle,
        selectedText: draft.payload.selectedText,
        precedingContext: draft.payload.precedingContext,
        followingContext: draft.payload.followingContext,
        question: q,
        history: [],
      })
      const trimmed = text.trim()
      if (!trimmed) {
        setError('AI boş yanıt döndü.')
        return
      }
      setAnswer(trimmed)
      setAskedQuestion(q)
    } catch (err) {
      setError(friendlyAiError(err))
    } finally {
      setLoading(false)
    }
  }

  if (draft.kind === 'note') {
    return (
      <section
        className={`pdf-insert pdf-insert--draft${matchClass(textStyle)}`}
        style={shellStyle}
      >
        <header className="pdf-insert__head">
          <p className="pdf-insert__label">
            Not ekle · seçimin altına
            {textStyle ? (
              <span className="pdf-insert__style-badge">· PDF stili</span>
            ) : null}
          </p>
          <button type="button" className="btn-ghost text-[11px]" onClick={onDismiss}>
            Vazgeç
          </button>
        </header>
        <p className="pdf-insert__quote">
          “…{draft.payload.selectedText.slice(0, 160)}
          {draft.payload.selectedText.length > 160 ? '…' : ''}”
        </p>
        <textarea
          className="field mt-2 text-sm pdf-insert__match-field"
          rows={3}
          autoFocus
          placeholder="Bu cümlenin altına eklenecek not…"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
        />
        <div className="pdf-insert__actions">
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={!noteBody.trim()}
            onClick={() =>
              onCommitNote?.({
                payload: draft.payload,
                body: noteBody.trim(),
                y: draft.y,
              })
            }
          >
            Kitaba ekle
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={onDismiss}>
            Vazgeç
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      className={`pdf-insert pdf-insert--draft pdf-insert--ai${matchClass(textStyle)}`}
      style={shellStyle}
    >
      <header className="pdf-insert__head">
        <p className="pdf-insert__label">
          {annotationAiLabel(draft.mode)} · seçimin altına
          {textStyle ? (
            <span className="pdf-insert__style-badge">· PDF stili</span>
          ) : null}
        </p>
        <button type="button" className="btn-ghost text-[11px]" onClick={onDismiss}>
          Vazgeç
        </button>
      </header>
      <p className="pdf-insert__quote">
        “…{draft.payload.selectedText.slice(0, 160)}
        {draft.payload.selectedText.length > 160 ? '…' : ''}”
      </p>

      {draft.mode === 'ask' && !answer && (
        <form onSubmit={(e) => void sendAsk(e)} className="mt-2 flex gap-2">
          <input
            className="field flex-1 text-sm"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ne sormak istersin?"
            autoFocus
          />
          <button
            type="submit"
            className="btn-primary shrink-0 text-xs"
            disabled={loading || !question.trim()}
          >
            Sor
          </button>
        </form>
      )}

      {loading && <p className="muted mt-3 text-sm">Düşünüyor…</p>}
      {error && <div className="alert-error mt-3 text-sm">{error}</div>}

      {answer && (
        <>
          <div className="pdf-insert__body prose study-textbook mt-3 max-w-none text-sm">
            <StudyMarkdown markdown={answer} />
          </div>
          <div className="pdf-insert__actions">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() =>
                onCommitAi?.({
                  payload: draft.payload,
                  mode: draft.mode,
                  question:
                    draft.mode === 'ask' ? askedQuestion || question || undefined : undefined,
                  body: answer,
                  y: draft.y,
                })
              }
            >
              Kitaba ekle
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={onDismiss}>
              Vazgeç
            </button>
          </div>
        </>
      )}
    </section>
  )
}
