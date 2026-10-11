import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBook, fetchChapter, generateSingleChapterContent } from '@/lib/api'
import ExplanationWithInlineChat from '@/components/ExplanationWithInlineChat'
import AppShell from '@/components/AppShell'
import MindMapPanel, { mindMapFromConcepts } from '@/components/MindMapPanel'
import QuizPlayer from '@/components/QuizPlayer'
import ContributionComposer from '@/components/ContributionComposer'
import ContributionReviewPanel from '@/components/ContributionReviewPanel'
import GroupChatPanel from '@/components/GroupChatPanel'
import PdfViewer, {
  type PdfSelectionAction,
  type PdfSelectionPayload,
} from '@/components/PdfViewer'
import PdfAiPanel from '@/components/PdfAiPanel'
import CiteDraftPanel from '@/components/CiteDraftPanel'
import FlashcardStories from '@/components/FlashcardStories'
import StudySplitPane from '@/components/StudySplitPane'
import {
  addPdfAnnotation,
  annotationKindLabel,
  loadPdfAnnotations,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import { citationStyleLabel } from '@/lib/citations'
import {
  findRelatedPassages,
  parsePageTextToSources,
  type PageSource,
} from '@/lib/sourceLookup'
import { useStudySession } from '@/hooks/useStudySession'
import { useBookPdfUrl } from '@/hooks/useBookPdfUrl'
import { friendlyAiError, isRetryableAiError } from '@/lib/errors'
import { markChapterOpened, markChapterQuiz } from '@/lib/studyProgress'
import { postGroupMessage } from '@/lib/groupChat'
import {
  fetchMyMembership,
  fetchStudyGroupByBook,
  roleAtLeast,
} from '@/lib/studyGroup'

/** Source-first study IA: PDF work surface, then AI notes, then drills. */
type StudyMode = 'read' | 'practice' | 'source'
type Depth = 'brief' | 'standard' | 'detailed'
type PracticePanel = 'flash' | 'quiz' | 'examples'

export default function ChapterPage() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  useStudySession(bookId, chapterId)
  const [mode, setMode] = useState<StudyMode>('source')
  const [depth, setDepth] = useState<Depth>('standard')
  const [practicePanel, setPracticePanel] = useState<PracticePanel>('flash')
  const [stylePref, setStylePref] = useState(
    'Gerçek dünya örnekleriyle, sade ve anlaşılır anlat',
  )
  const [genError, setGenError] = useState<string | null>(null)
  const [bookHits, setBookHits] = useState<
    Array<{ page: number; excerpt: string; score: number }>
  >([])
  const [mobilePane, setMobilePane] = useState<'pdf' | 'notes'>('pdf')
  const [pdfSel, setPdfSel] = useState<PdfSelectionPayload | null>(null)
  const [pdfMode, setPdfMode] = useState<'ask' | 'summarize' | 'explain' | null>(
    null,
  )
  const [draftCite, setDraftCite] = useState<PdfSelectionPayload | null>(null)
  const [draftNote, setDraftNote] = useState<PdfSelectionPayload | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [citeToast, setCiteToast] = useState<string | null>(null)
  const [pdfNotes, setPdfNotes] = useState<PdfAnnotation[]>([])
  const [flashOpen, setFlashOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [togetherOpen, setTogetherOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const autoRetryRef = useRef(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!bookId) {
      setPdfNotes([])
      return
    }
    setPdfNotes(loadPdfAnnotations(bookId))
  }, [bookId])

  const omittedQuotes = useMemo(
    () => pdfNotes.filter((n) => n.kind === 'omit').map((n) => n.quote),
    [pdfNotes],
  )
  const highlightedQuotes = useMemo(
    () =>
      pdfNotes
        .filter(
          (n) =>
            n.kind === 'highlight' || n.kind === 'note' || n.kind === 'ai',
        )
        .map((n) => n.quote),
    [pdfNotes],
  )

  function refreshPdfNotes() {
    if (bookId) setPdfNotes(loadPdfAnnotations(bookId))
  }

  const chapterQuery = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: () => fetchChapter(chapterId!),
    enabled: !!chapterId,
  })

  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => fetchBook(bookId!),
    enabled: !!bookId,
  })

  const groupQuery = useQuery({
    queryKey: ['study-group-by-book', bookId],
    queryFn: () => fetchStudyGroupByBook(bookId!),
    enabled: !!bookId,
  })

  const membershipQuery = useQuery({
    queryKey: ['group-me', groupQuery.data?.id],
    queryFn: () => fetchMyMembership(groupQuery.data!.id),
    enabled: !!groupQuery.data?.id,
  })

  const pdf = useBookPdfUrl(bookId, bookQuery.data?.file_url)
  const hasPdf = !!pdf.url

  useEffect(() => {
    if (bookId && chapterId) markChapterOpened(bookId, chapterId)
  }, [bookId, chapterId])

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  const ready = chapterQuery.data?.status === 'ready' && !!chapterQuery.data.explanation
  useEffect(() => {
    // Stay on PDF while notes generate; without PDF fall back to Anlatım
    if (!hasPdf && mode === 'source') setMode(ready ? 'read' : 'source')
    if (!ready && hasPdf && mode !== 'source') setMode('source')
  }, [ready, hasPdf, mode])

  const generateMutation = useMutation({
    mutationFn: () =>
      generateSingleChapterContent({
        id: chapterQuery.data!.id,
        title: chapterQuery.data!.title,
        style: stylePref.trim(),
      }),
    onSuccess: async () => {
      setGenError(null)
      autoRetryRef.current = 0
      await queryClient.invalidateQueries({ queryKey: ['chapter', chapterId] })
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
    },
    onError: (err) => {
      setGenError(friendlyAiError(err))
      void queryClient.invalidateQueries({ queryKey: ['chapter', chapterId] })
      if (isRetryableAiError(err) && autoRetryRef.current < 1) {
        autoRetryRef.current += 1
        window.setTimeout(() => generateMutation.mutate(), 1400)
      }
    },
  })

  const ch = chapterQuery.data
  const membership = membershipQuery.data
  const canWrite = roleAtLeast(membership?.role, 'write')

  function refreshChapter() {
    void queryClient.invalidateQueries({ queryKey: ['chapter', chapterId] })
  }

  const pageSources: PageSource[] = useMemo(() => {
    if (ch?.page_sources && Array.isArray(ch.page_sources) && ch.page_sources.length) {
      return ch.page_sources as PageSource[]
    }
    if (ch?.page_text) return parsePageTextToSources(ch.page_text)
    return []
  }, [ch?.page_sources, ch?.page_text])

  const markdownForDepth = useMemo(() => {
    if (!ch) return ''
    if (depth === 'brief') return ch.explanation_brief || ch.explanation || ''
    if (depth === 'detailed') {
      return ch.explanation_detailed || ch.explanation || ''
    }
    return ch.explanation || ''
  }, [ch, depth])

  const mindMap = useMemo(() => {
    if (!ch) return null
    if (ch.mind_map?.branches?.length) return ch.mind_map
    return mindMapFromConcepts(ch.title, ch.key_concepts ?? [])
  }, [ch])

  const needsContent =
    !!ch &&
    (ch.status === 'pending' ||
      ch.status === 'failed' ||
      (!ch.explanation && ch.status !== 'generating'))

  const depths: { id: Depth; label: string }[] = [
    { id: 'brief', label: 'Özet' },
    { id: 'standard', label: 'Genel' },
    { id: 'detailed', label: 'Detay' },
  ]

  const modes: { id: StudyMode; label: string }[] = [
    { id: 'source', label: 'PDF' },
    { id: 'read', label: 'Anlatım' },
    { id: 'practice', label: 'Alıştır' },
  ]

  function showInBook(selected: string) {
    const hits = findRelatedPassages(pageSources, selected)
    setBookHits(hits)
    setMode('source')
    setMobilePane('notes')
  }

  function handlePdfAction(payload: PdfSelectionPayload, m: PdfSelectionAction) {
    if (m === 'ask' || m === 'summarize' || m === 'explain') {
      setDraftCite(null)
      setDraftNote(null)
      setPdfSel(payload)
      setPdfMode(m)
      setMobilePane('notes')
      return
    }
    if ((m === 'cite' || m === 'extract') && bookId) {
      setPdfSel(null)
      setPdfMode(null)
      setDraftNote(null)
      setDraftCite(payload)
      setMobilePane('notes')
      return
    }
    if (m === 'note' && bookId) {
      setPdfSel(null)
      setPdfMode(null)
      setDraftCite(null)
      setDraftNote(payload)
      setNoteBody('')
      setMobilePane('notes')
      return
    }
    if ((m === 'highlight' || m === 'omit') && bookId) {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: m === 'omit' ? 'omit' : 'highlight',
        quote: payload.selectedText,
      })
      refreshPdfNotes()
      setCiteToast(m === 'omit' ? 'Metin gizlendi' : 'Vurgulandı')
      window.setTimeout(() => setCiteToast(null), 1800)
    }
  }

  const readBody =
    ready && ch ? (
      <div className="chapter-read">
        <div className="chapter-read__toolbar">
          <div className="mode-segment" role="tablist" aria-label="Derinlik">
            {depths.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={depth === d.id}
                onClick={() => setDepth(d.id)}
                className={`chip ${depth === d.id ? 'chip-active' : 'chip-idle'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {pdfSel && pdfMode && (
          <PdfAiPanel
            chapterId={ch.id}
            chapterTitle={ch.title}
            payload={pdfSel}
            mode={pdfMode}
            onClose={() => {
              setPdfSel(null)
              setPdfMode(null)
            }}
          />
        )}

        <section className="chapter-prose surface-panel p-5 sm:p-8">
          {!markdownForDepth ? (
            <p className="muted text-sm">
              Bu seviye henüz yok. Menüden içeriği yenileyebilirsin.
            </p>
          ) : (
            <ExplanationWithInlineChat
              chapterId={ch.id}
              chapterTitle={ch.title}
              markdown={markdownForDepth}
              depth={depth}
              onMarkdownSaved={() => {
                void queryClient.invalidateQueries({
                  queryKey: ['chapter', chapterId],
                })
              }}
              onShowInBook={showInBook}
            />
          )}

          {bookHits.length > 0 && (
            <div className="book-hits mt-5">
              <p className="book-hits__label">PDF’de olabilecek yerler</p>
              <ul className="mt-2 space-y-2">
                {bookHits.map((h, i) => (
                  <li key={i} className="book-hits__item">
                    <span className="font-semibold">s. {h.page}</span>
                    <p className="mt-0.5 whitespace-pre-wrap opacity-90">
                      …{h.excerpt}…
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {mindMap ? (
          <section className="chapter-map" aria-label="Konu haritası">
            <MindMapPanel
              data={mindMap}
              title={ch.title}
              markdown={markdownForDepth || ch.explanation}
            />
          </section>
        ) : null}
      </div>
    ) : null

  const practiceBody =
    ready && ch ? (
      <div className="chapter-practice">
        <div className="mode-segment" role="tablist" aria-label="Alıştır paneli">
          {(
            [
              ['flash', 'Flash'],
              ['quiz', 'Quiz'],
              ['examples', 'Örnekler'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={practicePanel === id}
              className={`chip ${practicePanel === id ? 'chip-active' : 'chip-idle'}`}
              onClick={() => setPracticePanel(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {practicePanel === 'flash' && (
          <div className="practice-hero">
            <p className="practice-hero__eyebrow">Mikro ders</p>
            <p className="font-display text-2xl font-semibold tracking-tight">
              Flash Stories
            </p>
            <p className="muted mt-2 max-w-md text-sm leading-relaxed">
              Kısa kartlarla ısın, öğren, soru çöz. Sesli okuma açık.
            </p>
            <button
              type="button"
              className="btn-primary mt-4"
              onClick={() => setFlashOpen(true)}
            >
              Başlat
            </button>
          </div>
        )}

        {practicePanel === 'quiz' && (
          <section className="surface-panel p-5 sm:p-8">
            <QuizPlayer
              quiz={ch.quiz ?? []}
              bookTitle={bookQuery.data?.title}
              chapterTitle={ch.title}
              onScored={(ok, total) => {
                if (bookId && chapterId) {
                  markChapterQuiz(bookId, chapterId, ok, total)
                }
              }}
              onShareScore={
                membership && groupQuery.data
                  ? async (ok, total) => {
                      await postGroupMessage({
                        groupId: groupQuery.data!.id,
                        chapterId: ch.id,
                        member: membership,
                        body: `Quiz skoru: ${ok}/${total} — “${ch.title}”`,
                      })
                    }
                  : undefined
              }
            />
          </section>
        )}

        {practicePanel === 'examples' && (
          <section className="surface-panel p-5 sm:p-8">
            <ExamplesPanel examples={ch.examples ?? []} />
          </section>
        )}
      </div>
    ) : null

  const pageMarks = useMemo(() => pdfNotes.slice(0, 12), [pdfNotes])

  const noteComposer =
    draftNote && bookId ? (
      <div className="surface-panel space-y-3 p-4">
        <p className="section-label mb-0">Benim notum</p>
        <blockquote className="pdf-ai-panel__quote text-sm">
          {draftNote.selectedText.slice(0, 220)}
          {draftNote.selectedText.length > 220 ? '…' : ''}
        </blockquote>
        <textarea
          className="field text-sm"
          rows={3}
          autoFocus
          placeholder="Kısa notun…"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              addPdfAnnotation(bookId, {
                page: draftNote.page,
                kind: 'note',
                quote: draftNote.selectedText,
                body: noteBody.trim() || undefined,
              })
              setDraftNote(null)
              setNoteBody('')
              refreshPdfNotes()
              setCiteToast('Not kaydedildi')
              window.setTimeout(() => setCiteToast(null), 1800)
            }}
          >
            Kaydet
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setDraftNote(null)
              setNoteBody('')
            }}
          >
            Vazgeç
          </button>
        </div>
      </div>
    ) : null

  const marksList =
    pageMarks.length > 0 ? (
      <div className="space-y-2">
        <p className="section-label">İşaretlerin</p>
        <ul className="space-y-2">
          {pageMarks.map((n) => (
            <li key={n.id} className="pdf-note-card text-xs">
              <p className="font-semibold">
                {annotationKindLabel(n.kind)} · s. {n.page}
              </p>
              <p className="muted mt-1 line-clamp-3">“{n.quote}”</p>
              {n.body ? <p className="mt-1.5">{n.body}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null

  const sourceNotes =
    ready && ch ? (
      <div className="space-y-4">
        {citeToast && <div className="alert-info text-sm">{citeToast}</div>}
        {noteComposer}
        {draftCite && bookId && (
          <CiteDraftPanel
            bookId={bookId}
            bookTitle={bookQuery.data?.title || ch.title || 'PDF'}
            payload={draftCite}
            onCancel={() => setDraftCite(null)}
            onSaved={(formatted, style) => {
              addPdfAnnotation(bookId, {
                page: draftCite.page,
                kind: 'cite',
                quote: draftCite.selectedText,
                body: formatted,
                citeStyle: style,
              })
              setDraftCite(null)
              refreshPdfNotes()
              setCiteToast(
                `${citationStyleLabel(style)} panoya + notlara eklendi`,
              )
              window.setTimeout(() => setCiteToast(null), 2200)
            }}
          />
        )}
        {pdfSel && pdfMode && (
          <PdfAiPanel
            chapterId={ch.id}
            chapterTitle={ch.title}
            payload={pdfSel}
            mode={pdfMode}
            onClose={() => {
              setPdfSel(null)
              setPdfMode(null)
            }}
          />
        )}
        {marksList}
        <SourcesPanel
          sources={pageSources}
          highlight={bookHits}
          onClearHighlight={() => setBookHits([])}
          showSelectHint={!pdfSel && !draftCite && !draftNote}
        />
      </div>
    ) : (
      <div className="space-y-3 p-1">
        {citeToast && <div className="alert-info text-sm">{citeToast}</div>}
        {noteComposer}
        {draftCite && bookId && (
          <CiteDraftPanel
            bookId={bookId}
            bookTitle={bookQuery.data?.title || ch?.title || 'PDF'}
            payload={draftCite}
            onCancel={() => setDraftCite(null)}
            onSaved={(formatted, style) => {
              addPdfAnnotation(bookId, {
                page: draftCite.page,
                kind: 'cite',
                quote: draftCite.selectedText,
                body: formatted,
                citeStyle: style,
              })
              setDraftCite(null)
              refreshPdfNotes()
              setCiteToast(`${citationStyleLabel(style)} kaydedildi`)
              window.setTimeout(() => setCiteToast(null), 2200)
            }}
          />
        )}
        <PdfAiPanel
          chapterId={ch?.id || chapterId || 'chapter'}
          chapterTitle={ch?.title || 'Ünite'}
          payload={pdfSel}
          mode={pdfMode}
          onClose={() => {
            setPdfSel(null)
            setPdfMode(null)
          }}
        />
        {marksList}
        {!pdfSel && !draftCite && !draftNote && <SourceSelectHint pendingNotes />}
      </div>
    )

  return (
    <AppShell
      wide={mode === 'source' && hasPdf}
      bookId={bookId}
      showBookTimer
    >
      <header className="chapter-hero">
        <div className="chapter-toolbar">
          <Link to={`/books/${bookId}`} className="btn-ghost chapter-toolbar__back">
            ← Kitap
          </Link>

          {(ready || hasPdf) && (
            <div className="mode-segment mode-segment--primary" role="tablist" aria-label="Çalışma modu">
              {modes
                .filter((m) => (m.id === 'source' ? hasPdf : ready))
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === m.id}
                    className={`chip ${mode === m.id ? 'chip-active' : 'chip-idle'}`}
                    onClick={() => {
                      setMode(m.id)
                      if (m.id === 'source') setMobilePane('pdf')
                      if (m.id === 'read') setMobilePane('notes')
                    }}
                  >
                    {m.label}
                  </button>
                ))}
            </div>
          )}

          <div className="chapter-more" ref={moreRef}>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-label="Daha fazla"
            >
              ⋯
            </button>
            {moreOpen && (
              <div className="chapter-more__panel space-y-3">
                {hasPdf && (
                  <Link
                    to={`/books/${bookId}/read`}
                    className="btn-ghost text-xs block text-center"
                    onClick={() => setMoreOpen(false)}
                  >
                    Tam PDF oku
                  </Link>
                )}
                {ready && (
                  <>
                    <label className="block text-xs">
                      <span className="muted mb-1 block font-medium">
                        Anlatım stili
                      </span>
                      <textarea
                        value={stylePref}
                        onChange={(e) => setStylePref(e.target.value)}
                        rows={2}
                        className="field text-xs"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-ghost w-full text-xs"
                      onClick={() => {
                        autoRetryRef.current = 0
                        setMoreOpen(false)
                        generateMutation.mutate()
                      }}
                    >
                      İçeriği yeniden üret
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={`chapter-hero__title ${mode === 'source' ? 'chapter-hero__title--compact' : ''}`}>
          <p className="section-label mb-1.5">Ünite</p>
          <h1 className="font-display font-semibold tracking-tight">
            {ch?.title || '…'}
          </h1>
          {ch?.summary && mode === 'source' && (
            <details className="chapter-summary-disclosure mt-2">
              <summary className="muted cursor-pointer text-xs font-semibold">
                Özet
              </summary>
              <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">
                {ch.summary}
              </p>
            </details>
          )}
          {ch?.summary && mode !== 'source' && (
            <p className="muted mt-2.5 max-w-2xl text-sm leading-relaxed line-clamp-2">
              {ch.summary}
            </p>
          )}
        </div>
      </header>

      {needsContent && ch?.status !== 'generating' && !generateMutation.isPending && (
        <div className="surface-panel mb-5 space-y-4 p-5 sm:p-7">
          <div className="text-center">
            <p className="font-display text-xl font-semibold">İçerik üret</p>
            <p className="muted mx-auto mt-1.5 max-w-md text-sm">
              Anlatım, Flash kartlar, örnek ve quiz oluştur.
              {hasPdf ? ' Bu arada PDF’de metin seçip AI’ya sorabilirsin.' : ''}
            </p>
          </div>
          <details className="text-sm">
            <summary className="muted cursor-pointer text-xs font-semibold">
              Anlatım tercihi (opsiyonel)
            </summary>
            <textarea
              value={stylePref}
              onChange={(e) => setStylePref(e.target.value)}
              rows={2}
              placeholder="Örn. basit dilde, sınav odaklı…"
              className="field mt-2"
            />
          </details>
          <div className="text-center">
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              className="btn-primary"
            >
              Üret
            </button>
          </div>
          {genError && (
            <div className="space-y-2 text-center">
              <div className="alert-error">{genError}</div>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  autoRetryRef.current = 0
                  setGenError(null)
                  generateMutation.mutate()
                }}
              >
                Tekrar dene
              </button>
            </div>
          )}
          {hasPdf && (
            <p className="text-center">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setMode('source')}
              >
                Şimdilik PDF’ye geç →
              </button>
            </p>
          )}
        </div>
      )}

      {(ch?.status === 'generating' || generateMutation.isPending) && (
        <div className="alert-info mb-4">
          İçerik üretiliyor… Her sayfa kapsanmaya çalışılıyor (özet + genel +
          detay).
        </div>
      )}

      {mode === 'read' && readBody}
      {mode === 'practice' && practiceBody}

      {mode === 'source' && hasPdf && (
        <StudySplitPane
          mobilePane={mobilePane}
          onMobilePaneChange={setMobilePane}
          left={
            <PdfViewer
              src={pdf.url!}
              startPage={ch?.start_page || 1}
              endPage={ch?.end_page || undefined}
              omittedQuotes={omittedQuotes}
              highlightedQuotes={highlightedQuotes}
              annotations={pdfNotes}
              bookId={bookId}
              chapterId={ch?.id || chapterId}
              chapterTitle={ch?.title || 'Ünite'}
              onAnnotationsChange={refreshPdfNotes}
              onAction={handlePdfAction}
            />
          }
          right={
            <div className="study-split__notes-inner space-y-3 p-3 sm:p-4">
              {sourceNotes}
            </div>
          }
        />
      )}

      {mode === 'source' && !hasPdf && (
        <div className="surface-panel p-5">
          <p className="muted text-sm">Bu kitap için PDF yok.</p>
          {sourceNotes}
        </div>
      )}

      {!ready && mode !== 'source' && hasPdf && !needsContent && (
        <p className="muted text-sm">
          Notlar hazır değilse{' '}
          <button type="button" className="underline" onClick={() => setMode('source')}>
            PDF
          </button>{' '}
          üzerinden çalışabilirsin.
        </p>
      )}

      {(canWrite || membership) && groupQuery.data && ch && (
        <div className="chapter-together mt-8">
          <button
            type="button"
            className="chapter-together__toggle"
            onClick={() => setTogetherOpen((v) => !v)}
            aria-expanded={togetherOpen}
          >
            <span>Birlikte çalış</span>
            <span className="muted text-xs">
              {togetherOpen ? 'Gizle' : 'Grup · sohbet'}
            </span>
          </button>
          {togetherOpen && (
            <div className="mt-4 space-y-4">
              {membership && canWrite && (
                <ContributionComposer
                  groupId={groupQuery.data.id}
                  chapterId={ch.id}
                  chapterTitle={ch.title}
                  membership={membership}
                  contextExcerpt={(ch.explanation || '').slice(0, 1200)}
                  onApplied={refreshChapter}
                />
              )}
              {membership && (
                <ContributionReviewPanel
                  chapterId={ch.id}
                  membership={membership}
                  onApplied={refreshChapter}
                />
              )}
              <GroupChatPanel
                groupId={groupQuery.data.id}
                chapterId={ch.id}
                membership={membership ?? null}
                title="Ünite sohbeti"
              />
            </div>
          )}
        </div>
      )}

      {ch && (
        <FlashcardStories
          open={flashOpen}
          onClose={() => setFlashOpen(false)}
          title={ch.title}
          markdown={markdownForDepth || ch.explanation || ''}
          keyConcepts={ch.key_concepts}
          quiz={ch.quiz}
          aiFlashcards={ch.flashcards}
        />
      )}
    </AppShell>
  )
}

function SourceSelectHint({ pendingNotes }: { pendingNotes?: boolean }) {
  return (
    <div className="source-select-hint space-y-1.5">
      <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
        PDF’de metin seç → AI · Cite · İşaretle
      </p>
      <p className="muted text-xs leading-relaxed">
        {pendingNotes
          ? 'Ünite notları hazır olunca Anlatım / Alıştır dolacak. PDF’de seç → Kitaba ekle ile seçimin altına yapıştır.'
          : 'PDF’de metin seç → AI yanıtını “Kitaba ekle” ile seçimin tam altına göm.'}
      </p>
    </div>
  )
}

function SourcesPanel({
  sources,
  highlight,
  onClearHighlight,
  showSelectHint,
}: {
  sources: PageSource[]
  highlight: Array<{ page: number; excerpt: string }>
  onClearHighlight: () => void
  showSelectHint?: boolean
}) {
  const usable = sources.filter((s) => !!s.excerpt?.trim())

  if (!usable.length) {
    return (
      <div className="space-y-3">
        {highlight.length > 0 && (
          <div className="space-y-2">
            <p className="section-label">Seçim eşleşmeleri</p>
            <ul className="space-y-2">
              {highlight.map((h, i) => (
                <li key={i} className="text-xs" style={{ color: 'var(--ink)' }}>
                  <span className="font-semibold">s. {h.page}</span>
                  <p className="mt-0.5 whitespace-pre-wrap opacity-90">
                    …{h.excerpt}…
                  </p>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onClearHighlight} className="btn-ghost text-xs">
              Vurguyu temizle
            </button>
          </div>
        )}
        {showSelectHint !== false && <SourceSelectHint />}
      </div>
    )
  }

  const highlightPages = new Set(highlight.map((h) => h.page))

  return (
    <section className="surface-panel space-y-4 p-4 sm:p-5">
      <p className="section-label">PDF kesitleri</p>
      <p className="muted text-sm leading-relaxed">
        Ham sayfa kesitleri — AI özeti değil.
      </p>
      {highlight.length > 0 && (
        <button type="button" onClick={onClearHighlight} className="btn-ghost">
          Seçim vurgusunu temizle
        </button>
      )}
      {usable.map((s) => (
        <article
          key={s.page}
          className="rounded-xl border px-4 py-3"
          style={{
            borderColor: highlightPages.has(s.page)
              ? 'rgba(154, 123, 79, 0.4)'
              : 'var(--line)',
            background: highlightPages.has(s.page)
              ? 'rgba(154, 123, 79, 0.1)'
              : 'rgba(255,255,255,0.55)',
          }}
        >
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-sm font-semibold">
              Sayfa {s.page}
            </h3>
            {s.topics?.length > 0 && (
              <p className="muted text-xs">{s.topics.join(' · ')}</p>
            )}
          </header>
          <p
            className="whitespace-pre-wrap text-xs leading-relaxed"
            style={{ color: 'var(--ink-muted)' }}
          >
            {s.excerpt}
          </p>
        </article>
      ))}
    </section>
  )
}

function ExamplesPanel({
  examples,
}: {
  examples: Array<{ problem: string; solution_steps: string[] }>
}) {
  if (!examples.length) {
    return <p className="muted">Henüz örnek yok.</p>
  }

  return (
    <ol className="space-y-6">
      {examples.map((ex, i) => (
        <li key={i} className="space-y-2">
          <p className="font-display text-lg font-semibold">
            Örnek {i + 1}: {ex.problem}
          </p>
          <ol
            className="list-decimal space-y-1 pl-5 text-sm"
            style={{ color: 'var(--ink-muted)' }}
          >
            {(ex.solution_steps ?? []).map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}
