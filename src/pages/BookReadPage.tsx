import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'
import {
  type PdfSelectionAction,
  type PdfSelectionPayload,
} from '@/types/pdfSelection'
import PdfViewer from '@/components/PdfViewer'
import StudyPdfReader from '@/components/StudyPdfReader'
import PdfAiPanel from '@/components/PdfAiPanel'
import CiteDraftPanel from '@/components/CiteDraftPanel'
import StudySplitPane from '@/components/StudySplitPane'
import { citationStyleLabel } from '@/lib/citations'
import { useBookPdfUrl } from '@/hooks/useBookPdfUrl'
import { useStudySession } from '@/hooks/useStudySession'
import { processBookPipeline } from '@/lib/processBook'
import { friendlyAiError } from '@/lib/errors'
import { loadCachedPageTexts } from '@/lib/pdfCache'
import {
  getImportJobStatus,
  startBackgroundTextExtract,
  subscribeImportJob,
  type ImportJobStatus,
} from '@/lib/bookImport'
import { pageNeedsOcr } from '@/lib/pageTextQuality'
import type { PageText } from '@/lib/slidingWindow'
import {
  addPdfAnnotation,
  annotationKindLabel,
  loadPdfAnnotations,
  removePdfAnnotation,
  type PdfAnnotation,
  updatePdfAnnotation,
} from '@/lib/pdfAnnotations'

type ViewMode = 'study' | 'original'

/** PDF → sayfa sayfa metin/markdown; tarama ise sayfa sayfa OCR. */
export default function BookReadPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  useStudySession(bookId)

  const [mobilePane, setMobilePane] = useState<'pdf' | 'notes'>('pdf')
  const [viewMode, setViewMode] = useState<ViewMode>('original')
  const [readerPage, setReaderPage] = useState(1)
  const [pages, setPages] = useState<PageText[]>([])
  const [sel, setSel] = useState<PdfSelectionPayload | null>(null)
  const [mode, setMode] = useState<'ask' | 'summarize' | 'explain' | null>(null)
  const [notes, setNotes] = useState<PdfAnnotation[]>(() =>
    bookId ? loadPdfAnnotations(bookId) : [],
  )
  const [draftNote, setDraftNote] = useState<{
    payload: PdfSelectionPayload
  } | null>(null)
  const [draftCite, setDraftCite] = useState<{
    payload: PdfSelectionPayload
  } | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<ImportJobStatus | null>(null)

  useEffect(() => {
    setReaderPage(1)
    setViewMode('original')
    setPages([])
    setSel(null)
    setMode(null)
    setDraftCite(null)
  }, [bookId])

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

  const pdf = useBookPdfUrl(bookId, bookQuery.data?.file_url)
  const chapters = chaptersQuery.data ?? []
  const hasUnits = chapters.length > 0
  const firstReady = chapters.find((c) => c.status === 'ready')
  const isProcessing = bookQuery.data?.status === 'processing'

  const hasReadable = pages.some((p) => !pageNeedsOcr(p.text))
  const loadingMore = importStatus?.phase === 'extracting'
  const totalPages = Math.max(
    importStatus?.total ?? 0,
    bookQuery.data?.total_pages ?? 0,
    pages.length,
  )

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    void (async () => {
      try {
        const cached = await loadCachedPageTexts(bookId)
        if (cancelled) return

        const existing = getImportJobStatus(bookId)
        if (existing && existing.phase !== 'error') {
          setImportStatus(existing)
          if (existing.pages?.length) setPages(existing.pages)
          else if (cached?.length) setPages(cached)
          return
        }

        if (cached?.length) {
          setPages(cached)
          // Eksik / boş sayfalar varsa progressive yeniden çalıştır
          const incomplete =
            (bookQuery.data?.total_pages || 0) > 0 &&
            cached.length < bookQuery.data!.total_pages!
          const manyEmpty =
            cached.filter((p) => pageNeedsOcr(p.text)).length >
            cached.length * 0.5
          if (incomplete || manyEmpty) {
            startBackgroundTextExtract({
              bookId,
              titleHint: bookQuery.data?.title,
            })
          }
          return
        }

        startBackgroundTextExtract({
          bookId,
          titleHint: bookQuery.data?.title,
        })
      } catch {
        if (!cancelled) setPages([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookId, bookQuery.data?.title, bookQuery.data?.total_pages])

  useEffect(() => {
    if (!bookId) return
    return subscribeImportJob((status) => {
      if (status.bookId !== bookId) return
      setImportStatus(status)
      if (status.pages?.length) setPages(status.pages)
      if (status.phase === 'done') {
        void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
        setToast(status.message)
        window.setTimeout(() => setToast(null), 2200)
      }
    })
  }, [bookId, queryClient])

  const omittedQuotes = useMemo(
    () => notes.filter((n) => n.kind === 'omit').map((n) => n.quote),
    [notes],
  )
  const highlightedQuotes = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            n.kind === 'highlight' || n.kind === 'note' || n.kind === 'ai',
        )
        .map((n) => n.quote),
    [notes],
  )

  const unitsMutation = useMutation({
    mutationFn: async () => {
      if (!bookId || !bookQuery.data) throw new Error('Kitap yok')
      await processBookPipeline({
        bookId,
        bookTitle: bookQuery.data.title,
        pages: pages.length ? pages : undefined,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
      setToast('Üniteler hazır')
      navigate(`/books/${bookId}`, { replace: false })
    },
    onError: (err) => setToast(friendlyAiError(err)),
  })

  function refreshNotes() {
    if (bookId) setNotes(loadPdfAnnotations(bookId))
  }

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  function handleAction(
    payload: PdfSelectionPayload,
    action: PdfSelectionAction,
  ) {
    if (!bookId) return

    if (action === 'ask' || action === 'summarize' || action === 'explain') {
      setSel(payload)
      setMode(action)
      setMobilePane('notes')
      return
    }

    if (action === 'note') {
      setDraftCite(null)
      setDraftNote({ payload })
      setNoteBody('')
      setMobilePane('notes')
      return
    }

    if (action === 'cite') {
      setDraftNote(null)
      setDraftCite({ payload })
      setMobilePane('notes')
      return
    }

    if (action === 'highlight') {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: 'highlight',
        quote: payload.selectedText,
      })
      refreshNotes()
      flash('Vurgulandı')
      return
    }

    if (action === 'omit') {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: 'omit',
        quote: payload.selectedText,
      })
      refreshNotes()
      flash('Metin çıkarıldı (gizli işaret)')
      return
    }

    if (action === 'extract') {
      // Legacy “Alıntıla” → Cite draft (same destination)
      setDraftNote(null)
      setDraftCite({ payload })
      setMobilePane('notes')
      return
    }

    if (action === 'bookmark') {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: 'bookmark',
        quote: payload.selectedText.slice(0, 120),
      })
      refreshNotes()
      flash('Yer imi eklendi')
    }
  }

  function savePersonalNote() {
    if (!bookId || !draftNote) return
    addPdfAnnotation(bookId, {
      page: draftNote.payload.page,
      kind: 'note',
      quote: draftNote.payload.selectedText,
      body: noteBody.trim() || undefined,
    })
    setDraftNote(null)
    setNoteBody('')
    refreshNotes()
    flash('Notun kaydedildi')
  }

  const leftPane =
    viewMode === 'study' && hasReadable ? (
      <StudyPdfReader
        pages={pages}
        totalPages={totalPages || undefined}
        bookTitle={bookQuery.data?.title}
        page={readerPage}
        onPageChange={setReaderPage}
        pdfSrc={pdf.url}
        loadingMore={loadingMore}
        omittedQuotes={omittedQuotes}
        highlightedQuotes={highlightedQuotes}
        annotations={notes}
        onAction={handleAction}
      />
    ) : pdf.url ? (
      <PdfViewer
        src={pdf.url}
        page={readerPage}
        onPageChange={setReaderPage}
        omittedQuotes={omittedQuotes}
        highlightedQuotes={highlightedQuotes}
        annotations={notes}
        bookId={bookId}
        chapterId={firstReady?.id || bookId}
        chapterTitle={bookQuery.data?.title || 'PDF'}
        onAnnotationsChange={refreshNotes}
        onAction={handleAction}
      />
    ) : (
      <p className="muted p-4 text-sm">
        {pdf.loading
          ? 'PDF hazırlanıyor…'
          : pdf.error ||
            'PDF bulunamadı. Aynı tarayıcıdan yeniden yüklemeyi dene.'}
      </p>
    )

  return (
    <AppShell wide bookId={bookId} showBookTimer>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="btn-ghost">
            ← Kitaplık
          </Link>
          <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {bookQuery.data?.title || 'PDF'}
          </h1>
          <p className="muted mt-1 max-w-xl text-xs leading-relaxed">
            Orijinal PDF sayfa sayfa çizilir. Studium = metin/markdown
            görünümü (arka planda hazırlanır).
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              className={`chip ${viewMode === 'study' ? 'chip-active' : 'chip-idle'}`}
              onClick={() => setViewMode('study')}
            >
              Studium
            </button>
            <button
              type="button"
              className={`chip ${viewMode === 'original' ? 'chip-active' : 'chip-idle'}`}
              onClick={() => setViewMode('original')}
            >
              Orijinal PDF
            </button>
            {importStatus?.phase === 'error' && (
              <button
                type="button"
                className="chip chip-idle"
                onClick={() => {
                  if (!bookId) return
                  startBackgroundTextExtract({
                    bookId,
                    titleHint: bookQuery.data?.title,
                  })
                }}
              >
                Yeniden dene
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasUnits ? (
            <Link to={`/books/${bookId}`} className="btn-ghost text-sm">
              Üniteler ({chapters.length})
            </Link>
          ) : (
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={
                unitsMutation.isPending ||
                isProcessing ||
                !pages.length ||
                loadingMore
              }
              onClick={() => {
                navigate(`/processing/${bookId}`)
                unitsMutation.mutate()
              }}
            >
              {unitsMutation.isPending || isProcessing
                ? 'Üniteler oluşuyor…'
                : loadingMore
                  ? 'Sayfalar hazırlanıyor…'
                  : 'Konuları / üniteleri oluştur'}
            </button>
          )}
          {firstReady && (
            <Link
              to={`/books/${bookId}/chapters/${firstReady.id}`}
              className="btn-ghost text-sm"
            >
              İlk ünite notu
            </Link>
          )}
        </div>
      </header>

      {toast && <div className="alert-info mb-3 text-sm">{toast}</div>}

      {loadingMore && (
        <div className="alert-info mb-3 text-sm">
          <p className="font-semibold">
            {hasReadable
              ? 'Okuyabilirsin — kalan sayfalar arka planda'
              : 'İlk sayfalar hazırlanıyor…'}
          </p>
          <p className="mt-1 opacity-90">{importStatus?.message}</p>
          {(importStatus?.total ?? 0) > 0 && (
            <div className="progress-track mt-2 max-w-md">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.round(
                    (100 * (importStatus?.done ?? 0)) /
                      (importStatus?.total ?? 1),
                  )}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {importStatus?.phase === 'error' && (
        <div className="alert-error mb-3 text-sm">{importStatus.message}</div>
      )}

      {!pdf.url && !pdf.loading && viewMode === 'original' && (
        <div className="alert-error mb-4">
          {pdf.error ||
            'Bu cihazda orijinal PDF bulunamadı. Aynı tarayıcıda yeniden yükle.'}
        </div>
      )}

      <StudySplitPane
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        left={leftPane}
        right={
          <div className="study-split__notes-inner space-y-4 p-3 sm:p-4">
            {draftNote && (
              <div className="surface-panel space-y-3 p-4">
                <p className="section-label mb-0">Benim notum</p>
                <blockquote className="pdf-ai-panel__quote">
                  {draftNote.payload.selectedText.slice(0, 220)}
                  {draftNote.payload.selectedText.length > 220 ? '…' : ''}
                </blockquote>
                <textarea
                  className="field text-sm"
                  rows={4}
                  autoFocus
                  placeholder="Kendi açıklaman, ipucu, ezber notu…"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={savePersonalNote}
                  >
                    Kaydet
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    onClick={() => setDraftNote(null)}
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}

            {draftCite && bookId && (
              <CiteDraftPanel
                bookId={bookId}
                bookTitle={bookQuery.data?.title || 'PDF'}
                payload={draftCite.payload}
                onCancel={() => setDraftCite(null)}
                onSaved={(formatted, style) => {
                  addPdfAnnotation(bookId, {
                    page: draftCite.payload.page,
                    kind: 'cite',
                    quote: draftCite.payload.selectedText,
                    body: formatted,
                    citeStyle: style,
                  })
                  setDraftCite(null)
                  refreshNotes()
                  flash(`${citationStyleLabel(style)} panoya + notlara eklendi`)
                }}
              />
            )}

            <PdfAiPanel
              chapterId={firstReady?.id || bookId || 'book'}
              chapterTitle={bookQuery.data?.title || 'PDF'}
              payload={sel}
              mode={mode}
              onClose={() => {
                setSel(null)
                setMode(null)
              }}
            />

            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="section-label mb-0">Notların & alıntılar</p>
                <span className="muted text-[11px]">{notes.length}</span>
              </div>
              {notes.length === 0 && !draftNote && !draftCite && !sel && (
                <div className="surface-panel p-5">
                  <p className="font-display text-lg font-semibold">
                    Ders kitabı gibi oku
                  </p>
                  <ul className="muted mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed">
                    <li>
                      Sol panel <strong>Studium</strong> — AI notlarıyla aynı
                      tipografi
                    </li>
                    <li>
                      Metin seç → özetle, sor, <strong>Cite</strong> (APA/IEEE/BibTeX)
                    </li>
                    <li>
                      Gerekirse <strong>Orijinal PDF</strong>e geç
                    </li>
                  </ul>
                </div>
              )}
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="pdf-note-card">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-deep)]">
                        {annotationKindLabel(n.kind)}
                        {n.kind === 'cite' && n.citeStyle
                          ? ` · ${String(n.citeStyle).toUpperCase()}`
                          : ''}{' '}
                        · s. {n.page}
                      </p>
                      <div className="flex shrink-0 gap-1">
                        {n.kind === 'cite' && n.body && (
                          <button
                            type="button"
                            className="btn-ghost text-[11px]"
                            onClick={() => {
                              void navigator.clipboard
                                ?.writeText(n.body || '')
                                .then(() => flash('Cite panoya kopyalandı'))
                                .catch(() => undefined)
                            }}
                          >
                            Kopyala
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost text-[11px]"
                          onClick={() => {
                            if (!bookId) return
                            setNotes(removePdfAnnotation(bookId, n.id))
                          }}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                      “{n.quote.slice(0, 160)}
                      {n.quote.length > 160 ? '…' : ''}”
                    </p>
                    {n.kind === 'note' && (
                      <textarea
                        className="field mt-2 text-sm"
                        rows={2}
                        placeholder="Notunu düzenle…"
                        value={n.body || ''}
                        onChange={(e) => {
                          if (!bookId) return
                          setNotes(
                            updatePdfAnnotation(bookId, n.id, {
                              body: e.target.value,
                            }),
                          )
                        }}
                      />
                    )}
                    {n.kind === 'cite' && n.body && (
                      <pre className="cite-preview mt-2">{n.body}</pre>
                    )}
                    {n.body && n.kind !== 'note' && n.kind !== 'cite' && (
                      <p className="mt-1.5 text-sm leading-relaxed">{n.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        }
      />
    </AppShell>
  )
}
