import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import StudyMarkdown from '@/components/StudyMarkdown'
import { askAboutSelection } from '@/lib/api'
import { friendlyAiError } from '@/lib/errors'
import {
  annotationAiLabel,
  annotationKindLabel,
  type PdfAnnotation,
  type PdfAiMode,
} from '@/lib/pdfAnnotations'
import { findQuoteAnchor } from '@/lib/pdfQuoteAnchor'
import type { PdfSelectionPayload } from '@/types/pdfSelection'

const MODE_Q: Record<PdfAiMode, string> = {
  summarize:
    'Seçili pasajı kısa ve net özetle. Madde işaretleri kullan; gereksiz uzatma.',
  explain:
    'Seçili pasajı bir öğrenciye açıkla: tanım, neden önemli, 1 günlük hayat benzetmesi.',
  ask: 'Seçili pasaj hakkında net ve öğretici bir açıklama yap.',
}

export type InlineDraft =
  | {
      kind: 'ai'
      mode: PdfAiMode
      payload: PdfSelectionPayload
      /** px relative to page host */
      top: number
      left: number
    }
  | {
      kind: 'note'
      payload: PdfSelectionPayload
      top: number
      left: number
    }

type Props = {
  pageHost: HTMLElement | null
  page: number
  annotations: PdfAnnotation[]
  draft: InlineDraft | null
  chapterId: string
  chapterTitle: string
  onDraftClose: () => void
  onSaveAi: (input: {
    payload: PdfSelectionPayload
    mode: PdfAiMode
    question?: string
    body: string
    top: number
    left: number
  }) => void
  onSaveNote: (input: {
    payload: PdfSelectionPayload
    body: string
    top: number
    left: number
  }) => void
  onRemove: (id: string) => void
}

type LaidCard = {
  id: string
  top: number
  left: number
  annotation?: PdfAnnotation
  draft?: InlineDraft
}

function layoutCards(
  host: HTMLElement,
  pageAnnots: PdfAnnotation[],
  draft: InlineDraft | null,
): LaidCard[] {
  const layer = host.querySelector('.textLayer') as HTMLElement | null
  const hostH = Math.max(host.clientHeight, 1)
  const hostW = Math.max(host.clientWidth, 1)
  const cards: LaidCard[] = []

  for (const a of pageAnnots) {
    if (a.kind === 'highlight' || a.kind === 'omit') continue
    let top: number | null = null
    let left = 16
    if (
      typeof a.anchorTopPct === 'number' &&
      typeof a.anchorLeftPct === 'number'
    ) {
      top = a.anchorTopPct * hostH
      left = a.anchorLeftPct * hostW
    } else if (layer) {
      const anchor = findQuoteAnchor(layer, a.quote)
      if (anchor) {
        top = anchor.bottom + 6
        left = anchor.left
      }
    }
    if (top == null) {
      // Fallback stack at bottom of page
      top = hostH * 0.72 + cards.length * 12
    }
    cards.push({ id: a.id, top, left: Math.max(8, left), annotation: a })
  }

  if (draft) {
    cards.push({
      id: '__draft__',
      top: draft.top,
      left: Math.max(8, draft.left),
      draft,
    })
  }

  cards.sort((a, b) => a.top - b.top || a.left - b.left)

  // Nudge overlapping cards downward
  const minGap = 8
  const estHeight = 120
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1]
    const cur = cards[i]
    if (cur.top < prev.top + estHeight + minGap) {
      cur.top = prev.top + estHeight + minGap
    }
  }

  return cards
}

export default function PdfInlineLayer({
  pageHost,
  page,
  annotations,
  draft,
  chapterId,
  chapterTitle,
  onDraftClose,
  onSaveAi,
  onSaveNote,
  onRemove,
}: Props) {
  const pageAnnots = useMemo(
    () => annotations.filter((a) => a.page === page),
    [annotations, page],
  )

  const [, bump] = useState(0)
  useEffect(() => {
    if (!pageHost) return
    const ro = new ResizeObserver(() => bump((n) => n + 1))
    ro.observe(pageHost)
    return () => ro.disconnect()
  }, [pageHost])

  const laid = useMemo(() => {
    if (!pageHost) return []
    return layoutCards(pageHost, pageAnnots, draft)
  }, [pageHost, pageAnnots, draft, page])

  if (!pageHost || (!laid.length && !draft)) return null

  return (
    <div className="pdf-inline-layer" aria-label="PDF notları">
      {laid.map((card) =>
        card.draft ? (
          <DraftCard
            key={card.id}
            draft={card.draft}
            top={card.top}
            left={card.left}
            chapterId={chapterId}
            chapterTitle={chapterTitle}
            onClose={onDraftClose}
            onSaveAi={onSaveAi}
            onSaveNote={onSaveNote}
          />
        ) : card.annotation ? (
          <SavedCard
            key={card.id}
            annotation={card.annotation}
            top={card.top}
            left={card.left}
            onRemove={() => onRemove(card.annotation!.id)}
          />
        ) : null,
      )}
    </div>
  )
}

function SavedCard({
  annotation,
  top,
  left,
  onRemove,
}: {
  annotation: PdfAnnotation
  top: number
  left: number
  onRemove: () => void
}) {
  const label =
    annotation.kind === 'ai'
      ? annotationAiLabel(annotation.aiMode)
      : annotationKindLabel(annotation.kind)

  return (
    <aside
      className={`pdf-inline-card pdf-inline-card--${annotation.kind}`}
      style={{ top, left }}
    >
      <header className="pdf-inline-card__head">
        <span>{label}</span>
        <button type="button" className="btn-ghost text-[11px]" onClick={onRemove}>
          Sil
        </button>
      </header>
      <p className="pdf-inline-card__quote">
        “{annotation.quote.slice(0, 140)}
        {annotation.quote.length > 140 ? '…' : ''}”
      </p>
      {annotation.question ? (
        <p className="pdf-inline-card__q">Soru: {annotation.question}</p>
      ) : null}
      {annotation.body ? (
        <div className="pdf-inline-card__body prose study-textbook max-w-none text-xs">
          <StudyMarkdown markdown={annotation.body} />
        </div>
      ) : null}
    </aside>
  )
}

function DraftCard({
  draft,
  top,
  left,
  chapterId,
  chapterTitle,
  onClose,
  onSaveAi,
  onSaveNote,
}: {
  draft: InlineDraft
  top: number
  left: number
  chapterId: string
  chapterTitle: string
  onClose: () => void
  onSaveAi: Props['onSaveAi']
  onSaveNote: Props['onSaveNote']
}) {
  const [question, setQuestion] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const savedRef = useRef(false)

  function persistAi(body: string, q?: string) {
    if (draft.kind !== 'ai' || savedRef.current) return
    savedRef.current = true
    onSaveAi({
      payload: draft.payload,
      mode: draft.mode,
      question: q,
      body,
      top: draft.top,
      left: draft.left,
    })
  }

  useEffect(() => {
    if (draft.kind !== 'ai') return
    if (draft.mode === 'ask') return

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
        persistAi(trimmed)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft identity drives run
  }, [draft, chapterId, chapterTitle])

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
      persistAi(trimmed, q)
    } catch (err) {
      setError(friendlyAiError(err))
    } finally {
      setLoading(false)
    }
  }

  if (draft.kind === 'note') {
    return (
      <aside className="pdf-inline-card pdf-inline-card--note pdf-inline-card--draft" style={{ top, left }}>
        <header className="pdf-inline-card__head">
          <span>Not ekle</span>
          <button type="button" className="btn-ghost text-[11px]" onClick={onClose}>
            Kapat
          </button>
        </header>
        <p className="pdf-inline-card__quote">
          “{draft.payload.selectedText.slice(0, 120)}
          {draft.payload.selectedText.length > 120 ? '…' : ''}”
        </p>
        <textarea
          className="field text-xs"
          rows={3}
          autoFocus
          placeholder="Seçimin altına notun…"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="btn-primary !px-3 !py-1.5 text-xs"
            disabled={!noteBody.trim()}
            onClick={() =>
              onSaveNote({
                payload: draft.payload,
                body: noteBody.trim(),
                top: draft.top,
                left: draft.left,
              })
            }
          >
            Kaydet
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            Vazgeç
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className="pdf-inline-card pdf-inline-card--ai pdf-inline-card--draft"
      style={{ top, left }}
    >
      <header className="pdf-inline-card__head">
        <span>{annotationAiLabel(draft.mode)}</span>
        <button type="button" className="btn-ghost text-[11px]" onClick={onClose}>
          Kapat
        </button>
      </header>
      <p className="pdf-inline-card__quote">
        “{draft.payload.selectedText.slice(0, 140)}
        {draft.payload.selectedText.length > 140 ? '…' : ''}”
      </p>

      {draft.mode === 'ask' && !answer && (
        <form onSubmit={(e) => void sendAsk(e)} className="mt-2 flex gap-1.5">
          <input
            className="field flex-1 text-xs"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ne sormak istersin?"
            autoFocus
          />
          <button
            type="submit"
            className="btn-primary !px-2.5 !py-1.5 text-xs shrink-0"
            disabled={loading || !question.trim()}
          >
            Sor
          </button>
        </form>
      )}

      {loading && <p className="muted mt-2 text-xs">Düşünüyor…</p>}
      {error && <div className="alert-error mt-2 text-xs">{error}</div>}
      {answer && (
        <div className="pdf-inline-card__body prose study-textbook mt-2 max-w-none text-xs">
          <StudyMarkdown markdown={answer} />
          <p className="muted mt-2 text-[11px]">PDF’ye eklendi · seçimin altında kalır</p>
        </div>
      )}
    </aside>
  )
}
