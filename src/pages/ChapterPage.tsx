import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchBook,
  fetchChapter,
  fetchChapters,
  generateSingleChapterContent,
  practiceDifficultyLabel,
  type PracticeDifficulty,
} from '@/lib/api'
import type { ExampleItem, QuizItem } from '@/types/database'
import AppShell from '@/components/AppShell'
import StudyLeftNav from '@/components/study/StudyLeftNav'
import StudyRightStudio, {
  type ReadStudioTab,
} from '@/components/study/StudyRightStudio'

const ExplanationWithInlineChat = lazy(
  () => import('@/components/ExplanationWithInlineChat'),
)
import MindMapPanel, { mindMapFromConcepts } from '@/components/MindMapPanel'
import QuizPlayer from '@/components/QuizPlayer'
import PracticeMoreBar from '@/components/PracticeMoreBar'
import ContributePanel from '@/components/ContributeDrawer'
import ContributionReviewPanel from '@/components/ContributionReviewPanel'
import GroupChatPanel from '@/components/GroupChatPanel'
import PdfViewer, {
  type PdfSelectionAction,
  type PdfSelectionPayload,
} from '@/components/PdfViewer'
import PdfAiPanel from '@/components/PdfAiPanel'
import CiteDraftPanel from '@/components/CiteDraftPanel'
import FlashcardStories from '@/components/FlashcardStories'
import StudyGuidePanel from '@/components/StudyGuidePanel'
import AudioOverviewPanel from '@/components/AudioOverviewPanel'
import StudySplitPane from '@/components/StudySplitPane'
import {
  addPdfAnnotation,
  annotationAiLabel,
  annotationKindLabel,
  loadPdfAnnotations,
  type PdfAnnotation,
} from '@/lib/pdfAnnotations'
import {
  downloadMarkdownAsPdf,
  downloadNotesPdf,
  exportableNotes,
} from '@/lib/exportNotesPdf'
import { isFlowInsert } from '@/lib/pdfInserts'
import { citationStyleLabel } from '@/lib/citations'
import { useStudySession } from '@/hooks/useStudySession'
import { useBookPdfUrl } from '@/hooks/useBookPdfUrl'
import { friendlyAiError, isRetryableAiError } from '@/lib/errors'
import { markChapterOpened, markChapterQuiz } from '@/lib/studyProgress'
import {
  isChapterDue,
  reviewChapter,
  reviewChapterAfterFlash,
  type SrsGrade,
} from '@/lib/srs'
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
  const [practicePanel, setPracticePanel] = useState<PracticePanel>('quiz')
  const [practiceDifficulty, setPracticeDifficulty] =
    useState<PracticeDifficulty>('medium')
  const [extraQuiz, setExtraQuiz] = useState<QuizItem[]>([])
  const [extraExamples, setExtraExamples] = useState<ExampleItem[]>([])
  const [stylePref, setStylePref] = useState(
    'Gerçek dünya örnekleriyle, sade ve anlaşılır anlat',
  )
  const [genError, setGenError] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<'pdf' | 'notes'>('pdf')
  const [pdfFocusPage, setPdfFocusPage] = useState<number | null>(null)
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
  const [edgeSettingsOpen, setEdgeSettingsOpen] = useState(false)
  const [contributeOpen, setContributeOpen] = useState(false)
  const [togetherOpen, setTogetherOpen] = useState(false)
  const [readStudio, setReadStudio] = useState<ReadStudioTab | null>(null)
  const autoRetryRef = useRef(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!bookId) {
      setPdfNotes([])
      return
    }
    setPdfNotes(loadPdfAnnotations(bookId))
    void import('@/lib/pdfAnnotationsSync').then((m) =>
      m.pullPdfAnnotations(bookId).then((merged) => setPdfNotes(merged)),
    )
    void import('@/lib/chapterProgressSync').then((m) =>
      m.pullChapterProgressForBook(bookId),
    )
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

  const chaptersQuery = useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => fetchChapters(bookId!),
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

  const ready = chapterQuery.data?.status === 'ready' && !!chapterQuery.data.explanation
  useEffect(() => {
    // Stay on PDF while notes generate; without PDF fall back to Anlatım
    if (!hasPdf && mode === 'source') setMode(ready ? 'read' : 'source')
    if (!ready && hasPdf && mode !== 'source') setMode('source')
  }, [ready, hasPdf, mode])

  const navChapters = useMemo(
    () =>
      (chaptersQuery.data ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        href: `/books/${bookId}/chapters/${c.id}`,
        ready: c.status === 'ready' && !!c.explanation,
      })),
    [chaptersQuery.data, bookId],
  )

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

  useEffect(() => {
    setExtraQuiz([])
    setExtraExamples([])
    setPracticeDifficulty('medium')
  }, [chapterId])

  const practiceContext = useMemo(() => {
    if (!ch) return ''
    const concepts = (ch.key_concepts ?? []).slice(0, 8).join(', ')
    const body = (markdownForDepth || ch.explanation || ch.summary || '').slice(
      0,
      2800,
    )
    return [ch.summary, concepts ? `Kavramlar: ${concepts}` : '', body]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3200)
  }, [ch, markdownForDepth])

  const combinedQuiz = useMemo(
    () => [...(ch?.quiz ?? []), ...extraQuiz],
    [ch?.quiz, extraQuiz],
  )
  const combinedExamples = useMemo(
    () => [...(ch?.examples ?? []), ...extraExamples],
    [ch?.examples, extraExamples],
  )

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

  const depthLabel =
    depth === 'brief' ? 'Kısa' : depth === 'detailed' ? 'Detaylı' : 'Standart'

  const readBody =
    ready && ch ? (
      <div className="chapter-read">
        {pdfSel && pdfMode && (
          <PdfAiPanel
            chapterId={ch.id}
            chapterTitle={ch.title}
            payload={pdfSel}
            mode={pdfMode}
            pageSources={ch.page_sources}
            onJumpPage={(page) => {
              setPdfFocusPage(page)
              setMode('source')
              setMobilePane('pdf')
            }}
            onClose={() => {
              setPdfSel(null)
              setPdfMode(null)
            }}
          />
        )}

        {readStudio === 'map' && mindMap ? (
          <section className="studio-stage studio-stage--map" aria-label="Konu haritası">
            <MindMapPanel
              data={mindMap}
              title={ch.title}
              markdown={markdownForDepth || ch.explanation}
            />
          </section>
        ) : null}

        {readStudio === 'guide' ? (
          <section className="studio-stage" aria-label="Çalışma kılavuzu">
            <StudyGuidePanel
              title={ch.title}
              summary={ch.summary}
              keyConcepts={ch.key_concepts}
              markdown={markdownForDepth || ch.explanation}
              quiz={ch.quiz}
              defaultOpen
              onOpenQuiz={() => {
                setReadStudio(null)
                setMode('practice')
                setPracticePanel('quiz')
                setFlashOpen(false)
              }}
            />
          </section>
        ) : null}

        {readStudio === 'audio' ? (
          <section className="studio-stage" aria-label="Sesli özet">
            <AudioOverviewPanel
              title={ch.title}
              summary={ch.summary}
              keyConcepts={ch.key_concepts}
              markdown={markdownForDepth || ch.explanation}
              defaultOpen
            />
          </section>
        ) : null}

        {readStudio === null ? (
          <section className="chapter-prose">
            {!markdownForDepth ? (
              <p className="muted text-sm">
                Bu seviye henüz yok. Menüden içeriği yenileyebilirsin.
              </p>
            ) : (
              <Suspense
                fallback={<p className="muted text-sm">Anlatım yükleniyor…</p>}
              >
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
                  onShowInBook={(selectedText) => {
                    setMode('source')
                    setMobilePane('pdf')
                    setCiteToast(
                      `PDF’de ara: “${selectedText.slice(0, 48)}${
                        selectedText.length > 48 ? '…' : ''
                      }”`,
                    )
                    window.setTimeout(() => setCiteToast(null), 2200)
                  }}
                  onLinkToPdf={(selectedText) => {
                    if (!bookId) return
                    addPdfAnnotation(bookId, {
                      page: pdfFocusPage ?? ch.start_page ?? 1,
                      kind: 'note',
                      quote: selectedText.slice(0, 400),
                      body: 'Anlatım’dan eklendi',
                    })
                    refreshPdfNotes()
                    setCiteToast('PDF notlarına eklendi')
                    window.setTimeout(() => setCiteToast(null), 1800)
                  }}
                />
              </Suspense>
            )}
            {membership && groupQuery.data ? (
              <div className="mt-6">
                <GroupChatPanel
                  groupId={groupQuery.data.id}
                  chapterId={ch.id}
                  membership={membership}
                  title="Ünite sohbeti"
                />
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    ) : null

  const chapterDue =
    !!(bookId && chapterId && isChapterDue(bookId, chapterId))

  const practiceBody =
    ready && ch ? (
      <div className="chapter-practice">
        {chapterDue && bookId && chapterId ? (
          <div className="srs-due-banner surface-panel p-4">
            <p className="section-label mb-1">Bugünkü tekrar</p>
            <p className="font-display text-base font-semibold tracking-tight">
              Bu ünite sırada
            </p>
            <p className="muted mt-1 text-xs">
              Sınav çöz veya Flash bitir; aralıklı tekrar otomatik planlanır.
            </p>
            <div className="srs-due-banner__grades mt-3">
              {(
                [
                  [0, 'Tekrar'],
                  [1, 'Zor'],
                  [2, 'İyi'],
                  [3, 'Kolay'],
                ] as const
              ).map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  className="chip chip-idle"
                  onClick={() => {
                    reviewChapter(bookId, chapterId, g as SrsGrade)
                    setCiteToast(`Tekrar planlandı · ${label}`)
                    window.setTimeout(() => setCiteToast(null), 1800)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div
          className="mode-segment mode-segment--secondary"
          role="tablist"
          aria-label="Alıştır paneli"
        >
          {(
            [
              ['quiz', 'Sınav'],
              ['examples', 'Çözümlü'],
              ['flash', 'Flash'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={practicePanel === id}
              className={`chip ${practicePanel === id ? 'chip-active' : 'chip-idle'}`}
              onClick={() => {
                setPracticePanel(id)
                setFlashOpen(false)
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="muted text-xs">
          Sınav soruları, çözümlü örnekler ve deneme. Flash isteğe bağlı tekrar.
        </p>

        {practicePanel === 'quiz' && (
          <section className="surface-panel p-5 sm:p-8">
            <div className="mb-4">
              <p className="section-label mb-1">Ünite sınavı</p>
              <p className="font-display text-lg font-semibold tracking-tight">
                Soru çöz · skor al
              </p>
            </div>
            <QuizPlayer
              quiz={combinedQuiz}
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
            <PracticeMoreBar
              kind="quiz"
              chapterTitle={ch.title}
              context={practiceContext}
              avoid={combinedQuiz.map((q) => q.question)}
              difficulty={practiceDifficulty}
              onDifficultyChange={setPracticeDifficulty}
              onGenerated={({ quiz }) => {
                if (quiz?.length) setExtraQuiz((prev) => [...prev, ...quiz])
              }}
            />
          </section>
        )}

        {practicePanel === 'examples' && (
          <section className="surface-panel p-5 sm:p-8">
            <div className="mb-4">
              <p className="section-label mb-1">Çözümlü örnekler</p>
              <p className="font-display text-lg font-semibold tracking-tight">
                Adım adım çözüm
              </p>
            </div>
            <ExamplesPanel examples={combinedExamples} />
            <PracticeMoreBar
              kind="example"
              chapterTitle={ch.title}
              context={practiceContext}
              avoid={combinedExamples.map((ex) => ex.problem)}
              difficulty={practiceDifficulty}
              onDifficultyChange={setPracticeDifficulty}
              onGenerated={({ examples }) => {
                if (examples?.length)
                  setExtraExamples((prev) => [...prev, ...examples])
              }}
            />
          </section>
        )}

        {practicePanel === 'flash' && (
          <div className="practice-hero surface-panel p-5 sm:p-7">
            <p className="section-label mb-1">Flash Stories</p>
            <p className="font-display text-xl font-semibold tracking-tight">
              Kartlarla hızlı tekrar
            </p>
            <p className="muted mt-2 max-w-md text-sm leading-relaxed">
              Sınavdan önce kısa ısınma — ana alıştırma Sınav ve Çözümlü’de.
            </p>
            <button
              type="button"
              className="btn-primary mt-4"
              onClick={() => setFlashOpen(true)}
            >
              Flash’ı başlat
            </button>
          </div>
        )}
      </div>
    ) : null

  const pageMarks = useMemo(
    () =>
      pdfNotes
        .filter((a) => isFlowInsert(a) || a.kind === 'cite')
        .sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt)),
    [pdfNotes],
  )
  const panelFocus = !!(pdfSel && pdfMode) || !!draftCite || !!draftNote

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

  function clearPanelFocus() {
    setPdfSel(null)
    setPdfMode(null)
    setDraftCite(null)
    setDraftNote(null)
    setNoteBody('')
  }

  const sourceNotes = (
    <div
      className={`notes-rail ${panelFocus ? 'notes-rail--focus' : ''}`}
    >
      <header className="notes-rail__head">
        <div>
          <p className="notes-rail__title">Notlar</p>
          <p className="notes-rail__sub">
            {panelFocus
              ? 'Şu an tek iş'
              : pageMarks.length > 0
                ? `${pageMarks.length} ek`
                : 'Metin seç → sor / Cite'}
          </p>
        </div>
        <div className="notes-rail__actions">
          {panelFocus ? (
            <button
              type="button"
              className="btn-ghost text-[11px]"
              onClick={clearPanelFocus}
            >
              Kapat
            </button>
          ) : null}
        </div>
      </header>

      {citeToast && (
        <div className="alert-info notes-rail__toast text-sm">{citeToast}</div>
      )}

      <div className="notes-rail__body">
        {panelFocus ? (
          <div className="notes-rail__workspace">
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
                  setCiteToast(
                    `${citationStyleLabel(style)} panoya + notlara eklendi`,
                  )
                  window.setTimeout(() => setCiteToast(null), 2200)
                }}
              />
            )}
            {pdfSel && pdfMode && (
              <PdfAiPanel
                chapterId={ch?.id || chapterId || 'chapter'}
                chapterTitle={ch?.title || 'Ünite'}
                payload={pdfSel}
                mode={pdfMode}
                pageSources={ch?.page_sources}
                onJumpPage={(page) => {
                  setPdfFocusPage(page)
                  setMobilePane('pdf')
                }}
                onClose={() => {
                  setPdfSel(null)
                  setPdfMode(null)
                }}
              />
            )}
          </div>
        ) : (
          <>
            {pageMarks.length === 0 ? (
              <div className="notes-empty">
                <p className="notes-empty__title">
                  {ready ? 'Soldan metin seç' : 'Önce kaynakta çalış'}
                </p>
                <p className="muted text-xs leading-relaxed">
                  AI’ya sor · Cite · Vurgula — cevaplar burada ve PDF’nin içinde
                  toplanır.
                </p>
              </div>
            ) : (
              <ul className="notes-feed">
                {pageMarks.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="notes-card"
                      onClick={() => {
                        setPdfFocusPage(n.page)
                        setMobilePane('pdf')
                      }}
                    >
                      <span className="notes-card__meta">
                        {n.kind === 'ai'
                          ? annotationAiLabel(n.aiMode)
                          : annotationKindLabel(n.kind)}
                        <span aria-hidden>·</span>
                        s. {n.page}
                      </span>
                      <span className="notes-card__quote">
                        “{n.quote.replace(/\s+/g, ' ').slice(0, 110)}
                        {n.quote.length > 110 ? '…' : ''}”
                      </span>
                      {n.body ? (
                        <span className="notes-card__body">
                          {n.body.replace(/\s+/g, ' ').slice(0, 140)}
                          {n.body.length > 140 ? '…' : ''}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )

  return (
    <AppShell
      wide={hasPdf}
      bookId={bookId}
      showBookTimer
      studyChrome={hasPdf}
      studyContext={
        bookQuery.data || ch ? (
          <div className="study-crumb" aria-label="Konum">
            <Link to={`/books/${bookId}`} className="study-crumb__book">
              {bookQuery.data?.title || 'Kitap'}
            </Link>
            {ch?.title ? (
              <>
                <span className="study-crumb__sep" aria-hidden>
                  /
                </span>
                <span className="study-crumb__chapter">{ch.title}</span>
              </>
            ) : null}
          </div>
        ) : null
      }
    >
      <StudyLeftNav
        bookTitle={bookQuery.data?.title || 'Kitap'}
        bookHref={`/books/${bookId}`}
        chapters={navChapters}
        activeChapterId={chapterId}
      />

      <StudyRightStudio
        showStudio={mode === 'read' && ready}
        active={readStudio}
        onChange={setReadStudio}
        hasMap={!!mindMap}
        tools={[
          {
            id: 'flash',
            label: 'Flash',
            title: 'Flash Stories’i aç',
            active: flashOpen,
            hidden: !ready,
            onClick: () => {
              setContributeOpen(false)
              setEdgeSettingsOpen(false)
              setMode('practice')
              setPracticePanel('flash')
              setFlashOpen(true)
              setMobilePane('notes')
            },
          },
          {
            id: 'export',
            label: 'İndir',
            title:
              mode === 'source'
                ? 'Notları PDF indir'
                : 'Anlatımı PDF indir',
            hidden:
              mode === 'source'
                ? exportableNotes(pdfNotes).length === 0
                : mode !== 'read' || !markdownForDepth,
            onClick: () => {
              if (mode === 'source') {
                void downloadNotesPdf(exportableNotes(pdfNotes), {
                  bookTitle: bookQuery.data?.title || 'Studium',
                  chapterTitle: ch?.title,
                })
                return
              }
              if (!markdownForDepth || !ch) return
              void downloadMarkdownAsPdf(markdownForDepth, {
                bookTitle: bookQuery.data?.title || 'Studium',
                chapterTitle: ch.title,
                subtitle: `Anlatım · ${depthLabel}`,
              })
            },
          },
          {
            id: 'full-pdf',
            label: 'PDF',
            title: 'Kitabın tamamını oku',
            href: bookId ? `/books/${bookId}/read` : undefined,
            hidden: !hasPdf || !bookId || mode === 'source',
          },
          {
            id: 'contribute',
            label: 'Ekle',
            title: 'İçerik ekle',
            active: contributeOpen,
            hidden: !(membership && canWrite && groupQuery.data && ch),
            onClick: () => {
              setEdgeSettingsOpen(false)
              setContributeOpen((v) => !v)
            },
          },
          {
            id: 'together',
            label: 'Sohbet',
            title: 'Onaylar ve sohbet',
            active: togetherOpen,
            hidden: !(membership && groupQuery.data && ch),
            onClick: () => {
              setContributeOpen(false)
              setTogetherOpen((v) => {
                const next = !v
                if (next) {
                  window.setTimeout(() => {
                    document
                      .getElementById('chapter-together')
                      ?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                      })
                  }, 50)
                }
                return next
              })
            },
          },
          {
            id: 'settings',
            label: 'Ayar',
            title: 'Anlatım stili · yeniden üret',
            active: edgeSettingsOpen,
            hidden: !ready,
            onClick: () => {
              setContributeOpen(false)
              setEdgeSettingsOpen((v) => !v)
            },
          },
        ]}
        panelOpen={
          (contributeOpen &&
            !!(membership && canWrite && groupQuery.data && ch)) ||
          (edgeSettingsOpen && ready)
        }
        panelTitle={contributeOpen ? 'İçerik ekle' : 'Ayarlar'}
        panelWide={contributeOpen}
        onClosePanel={() => {
          setContributeOpen(false)
          setEdgeSettingsOpen(false)
        }}
        panel={
          contributeOpen && membership && canWrite && groupQuery.data && ch ? (
            <ContributePanel
              groupId={groupQuery.data.id}
              chapterId={ch.id}
              chapterTitle={ch.title}
              membership={membership}
              contextExcerpt={(
                ch.explanation ||
                markdownForDepth ||
                ''
              ).slice(0, 1200)}
              onApplied={refreshChapter}
            />
          ) : (
            <div className="space-y-3">
              <label className="block text-xs">
                <span className="muted mb-1 block font-medium">
                  Anlatım stili
                </span>
                <textarea
                  value={stylePref}
                  onChange={(e) => setStylePref(e.target.value)}
                  rows={3}
                  className="field text-xs"
                />
              </label>
              <button
                type="button"
                className="btn-ghost w-full text-xs"
                onClick={() => {
                  autoRetryRef.current = 0
                  setEdgeSettingsOpen(false)
                  generateMutation.mutate()
                }}
              >
                İçeriği yeniden üret
              </button>
            </div>
          )
        }
      />

      <header className="chapter-hero chapter-hero--study">
        <div className="chapter-toolbar">
          {(ready || hasPdf) && (
            <div
              className="mode-segment mode-segment--primary"
              role="tablist"
              aria-label="Çalışma modu"
            >
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
                      if (m.id !== 'read') setReadStudio(null)
                      if (m.id === 'source') setMobilePane('pdf')
                      if (m.id === 'read' || m.id === 'practice') {
                        setMobilePane('notes')
                      }
                      if (m.id === 'practice') {
                        setPracticePanel('quiz')
                        setFlashOpen(false)
                      }
                    }}
                  >
                    {m.label}
                  </button>
                ))}
            </div>
          )}

          {mode === 'read' && ready && (
            <div
              className="mode-segment mode-segment--secondary"
              role="tablist"
              aria-label="Anlatım derinliği"
            >
              {depths.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  aria-selected={depth === d.id}
                  className={`chip ${depth === d.id ? 'chip-active' : 'chip-idle'}`}
                  onClick={() => setDepth(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className={`chapter-hero__title ${
            hasPdf ? 'chapter-hero__title--compact' : ''
          }`}
        >
          <h1 className="font-display font-semibold tracking-tight">
            {ch?.title || '…'}
          </h1>
          {ch?.summary && hasPdf && (
            <details className="chapter-summary-disclosure mt-2">
              <summary className="muted cursor-pointer text-xs font-semibold">
                Özet
              </summary>
              <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">
                {ch.summary}
              </p>
            </details>
          )}
          {ch?.summary && !hasPdf && (
            <p className="muted mt-2 max-w-2xl text-sm leading-relaxed line-clamp-2">
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

      {hasPdf ? (
        <StudySplitPane
          rightLabel={
            mode === 'read'
              ? 'Anlatım'
              : mode === 'practice'
                ? 'Alıştır'
                : 'Notlar'
          }
          mobilePane={mobilePane}
          onMobilePaneChange={setMobilePane}
          left={
            <PdfViewer
              src={pdf.url!}
              startPage={ch?.start_page || 1}
              endPage={ch?.end_page || undefined}
              page={pdfFocusPage ?? ch?.start_page ?? undefined}
              onPageChange={(p) => setPdfFocusPage(p)}
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
            mode === 'source' ? (
              sourceNotes
            ) : mode === 'read' ? (
              readBody ?? (
                <p className="muted text-sm">Anlatım henüz hazır değil.</p>
              )
            ) : (
              practiceBody ?? (
                <p className="muted text-sm">Alıştır henüz hazır değil.</p>
              )
            )
          }
        />
      ) : (
        <>
          {mode === 'read' && readBody}
          {mode === 'practice' && practiceBody}
          {mode === 'source' && (
            <div className="surface-panel p-5">
              <p className="muted text-sm">Bu kitap için PDF yok.</p>
              {sourceNotes}
            </div>
          )}
        </>
      )}

      {togetherOpen && membership && groupQuery.data && ch && (
        <div className="chapter-together mt-8" id="chapter-together">
          <div className="mt-2 space-y-4">
            <ContributionReviewPanel
              chapterId={ch.id}
              membership={membership}
              onApplied={refreshChapter}
            />
            <GroupChatPanel
              groupId={groupQuery.data.id}
              chapterId={ch.id}
              membership={membership}
              title="Ünite sohbeti"
            />
          </div>
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
          onDeckComplete={() => {
            if (bookId && chapterId) {
              reviewChapterAfterFlash(bookId, chapterId)
              setCiteToast('Flash bitti · tekrar planı güncellendi')
              window.setTimeout(() => setCiteToast(null), 2000)
            }
          }}
        />
      )}

    </AppShell>
  )
}

function ExamplesPanel({
  examples,
}: {
  examples: ExampleItem[]
}) {
  if (!examples.length) {
    return (
      <div className="study-empty">
        <p className="study-empty__title">Örnek yok</p>
        <p className="muted text-xs">
          Aşağıdan zorluk ve adet seçip yeni çözümlü ekleyebilirsin.
        </p>
      </div>
    )
  }

  return (
    <ol className="space-y-6">
      {examples.map((ex, i) => {
        const diff = practiceDifficultyLabel(ex.difficulty)
        return (
          <li key={`${i}-${ex.problem.slice(0, 40)}`} className="space-y-2">
            {diff ? (
              <p className="muted text-[11px] font-semibold tracking-wide uppercase">
                <span className="practice-item-diff">{diff}</span>
              </p>
            ) : null}
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
        )
      })}
    </ol>
  )
}
