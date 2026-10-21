import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  downloadNotesMarkdown,
  downloadNotesPdf,
  exportableNotes,
} from '@/lib/exportNotesPdf'
import { downloadPdfWithInserts } from '@/lib/exportPdfWithInserts'
import PdfOrganizePanel from '@/components/PdfOrganizePanel'
import { rememberPdf } from '@/lib/pdfSession'
import { fetchPdfBytes, pdfBytesToBlob } from '@/lib/pdfManipulate'

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
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [pdfRefresh, setPdfRefresh] = useState(0)
  const [workingBytes, setWorkingBytes] = useState<Uint8Array | null>(null)
  const [workingUrl, setWorkingUrl] = useState<string | null>(null)
  const workingSeedGen = useRef(0)

  useEffect(() => {
    setReaderPage(1)
    setViewMode('original')
    setPages([])
    setSel(null)
    setMode(null)
    setDraftCite(null)
    if (!bookId) {
      setNotes([])
      return
    }
    setNotes(loadPdfAnnotations(bookId))
    void import('@/lib/pdfAnnotationsSync').then((m) =>
      m.pullPdfAnnotations(bookId).then(setNotes),
    )
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

  const pdf = useBookPdfUrl(bookId, bookQuery.data?.file_url, pdfRefresh)
  const chapters = chaptersQuery.data ?? []
  const hasUnits = chapters.length > 0
  const firstReady = chapters.find((c) => c.status === 'ready')
  const isProcessing = bookQuery.data?.status === 'processing'

  // Session working copy — pdf-lib edits + organize share these bytes
  useEffect(() => {
    if (!pdf.url) {
      workingSeedGen.current += 1
      setWorkingBytes(null)
      return
    }
    const gen = ++workingSeedGen.current
    let cancelled = false
    void (async () => {
      try {
        const raw = await fetchPdfBytes(pdf.url!)
        if (!cancelled && gen === workingSeedGen.current) setWorkingBytes(raw)
      } catch {
        if (!cancelled && gen === workingSeedGen.current) setWorkingBytes(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdf.url, pdfRefresh])

  useEffect(() => {
    if (!workingBytes) {
      setWorkingUrl(null)
      return
    }
    const url = URL.createObjectURL(pdfBytesToBlob(workingBytes))
    setWorkingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [workingBytes])

  function applyWorkingBytes(next: Uint8Array) {
    workingSeedGen.current += 1
    setWorkingBytes(next)
    if (bookId) rememberPdf(bookId, pdfBytesToBlob(next))
  }

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
    () =>
      notes
        .filter((n) => n.kind === 'omit' || n.kind === 'replace')
        .map((n) => n.quote),
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
  const underlinedQuotes = useMemo(
    () => notes.filter((n) => n.kind === 'underline').map((n) => n.quote),
    [notes],
  )
  const struckQuotes = useMemo(
    () => notes.filter((n) => n.kind === 'strike').map((n) => n.quote),
    [notes],
  )
  const redactedQuotes = useMemo(
    () => notes.filter((n) => n.kind === 'redact').map((n) => n.quote),
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

    // AI / note → sağ panel (sayfa dilimleme yok)
    if (action === 'ask' || action === 'summarize' || action === 'explain') {
      setDraftCite(null)
      setDraftNote(null)
      setSel(payload)
      setMode(action)
      setMobilePane('notes')
      return
    }

    if (action === 'note') {
      setSel(null)
      setMode(null)
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

    if (action === 'copy') {
      void navigator.clipboard
        ?.writeText(payload.selectedText)
        .then(() => flash('Kopyalandı'))
        .catch(() => flash('Kopyalanamadı'))
      return
    }

    if (action === 'redact') {
      flash('Sansürlendi — PDF güncellendi')
      return
    }

    if (action === 'replace') {
      flash('Metin güncellendi (sayfa değişince PDF’ye yazılır)')
      return
    }

    if (action === 'highlight') {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: 'highlight',
        quote: payload.selectedText,
        textStyle: payload.textStyle,
      })
      refreshNotes()
      flash('Vurgulandı')
      return
    }

    if (action === 'underline') {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: 'underline',
        quote: payload.selectedText,
      })
      refreshNotes()
      flash('Altı çizildi')
      return
    }

    if (action === 'strike') {
      addPdfAnnotation(bookId, {
        page: payload.page,
        kind: 'strike',
        quote: payload.selectedText,
      })
      refreshNotes()
      flash('Üstü çizildi')
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
      textStyle: draftNote.payload.textStyle,
      region: draftNote.payload.region,
      anchorTopPct: draftNote.payload.region
        ? Math.min(
            0.98,
            draftNote.payload.region.topPct +
              draftNote.payload.region.heightPct,
          )
        : 0.42,
      anchorLeftPct: draftNote.payload.region?.leftPct ?? 0.06,
    })
    setDraftNote(null)
    setNoteBody('')
    refreshNotes()
    setMobilePane('pdf')
    setViewMode('original')
    flash('Not seçimin altına eklendi')
  }

  function saveAiToPdf(input: {
    payload: PdfSelectionPayload
    mode: 'ask' | 'summarize' | 'explain'
    body: string
    question?: string
  }) {
    if (!bookId) throw new Error('Kitap kimliği yok')
    const body = (input.body || '').trim()
    if (!body) throw new Error('Eklenecek AI metni yok')

    const region = input.payload.region
    // Seçimin bittiği yere (cümle sonu) — eski usul
    const anchorTopPct = region
      ? Math.min(0.98, region.topPct + region.heightPct)
      : 0.42

    addPdfAnnotation(bookId, {
      page: input.payload.page,
      kind: 'ai',
      aiMode: input.mode,
      quote: input.payload.selectedText,
      question: input.question,
      body,
      textStyle: input.payload.textStyle,
      region,
      anchorTopPct,
      anchorLeftPct: region?.leftPct ?? 0.06,
    })
    setNotes(loadPdfAnnotations(bookId))
    flash('AI seçimin altına eklendi')
    setMobilePane('pdf')
    setViewMode('original')
    setReaderPage(input.payload.page)
    setSel(null)
    setMode(null)
  }

  const insertChapterId =
    firstReady?.id || chapters[0]?.id || bookId || ''

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
        bookId={bookId}
        chapterId={insertChapterId}
        chapterTitle={bookQuery.data?.title || 'PDF'}
        onAnnotationsChange={refreshNotes}
        onAction={handleAction}
      />
    ) : (workingUrl || pdf.url) && bookId ? (
      <PdfViewer
        src={workingUrl || pdf.url!}
        data={workingBytes ?? undefined}
        onWorkingBytesChange={applyWorkingBytes}
        page={readerPage}
        onPageChange={setReaderPage}
        omittedQuotes={omittedQuotes}
        highlightedQuotes={highlightedQuotes}
        underlinedQuotes={underlinedQuotes}
        struckQuotes={struckQuotes}
        redactedQuotes={redactedQuotes}
        annotations={notes}
        bookId={bookId}
        chapterId={insertChapterId}
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
    <AppShell wide bookId={bookId} showBookTimer studyChrome>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="btn-ghost">
            ← Kitaplık
          </Link>
          <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {bookQuery.data?.title || 'PDF'}
          </h1>
          <p className="muted mt-1 max-w-xl text-xs leading-relaxed">
            Metin seç → AI / Not → Seçimin altına ekle: sayfa aralanır, kart araya girer.
          </p>
          <div
            className="mode-segment mode-segment--secondary mt-2.5"
            role="tablist"
            aria-label="Kaynak görünümü"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'study'}
              className={`chip ${viewMode === 'study' ? 'chip-active' : 'chip-idle'}`}
              onClick={() => setViewMode('study')}
            >
              Metin
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'original'}
              className={`chip ${viewMode === 'original' ? 'chip-active' : 'chip-idle'}`}
              onClick={() => setViewMode('original')}
            >
              PDF
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
          {pdf.url ? (
            <button
              type="button"
              className={`chip text-sm ${organizeOpen ? 'chip-active' : 'chip-idle'}`}
              onClick={() => {
                setOrganizeOpen((v) => !v)
                setMobilePane('notes')
              }}
            >
              PDF düzenle
            </button>
          ) : null}
          {workingBytes || pdf.url ? (
            <button
              type="button"
              className="btn-ghost text-sm"
              title="Kitabı AI / not ekleriyle birlikte indir"
              onClick={() => {
                void (async () => {
                  try {
                    flash('PDF hazırlanıyor…')
                    let bytes = workingBytes
                    if (!bytes && pdf.url) {
                      bytes = await fetchPdfBytes(pdf.url)
                    }
                    if (!bytes) {
                      flash('PDF bulunamadı')
                      return
                    }
                    await downloadPdfWithInserts({
                      pdfBytes: bytes,
                      annotations: notes,
                      filename: `${bookQuery.data?.title || 'studium'}-ai-ekli`,
                      onProgress: (msg) => flash(msg),
                    })
                    flash(
                      exportableNotes(notes).length
                        ? 'Kitap AI ekleriyle indirildi'
                        : 'Kitap indirildi',
                    )
                  } catch (err) {
                    flash(friendlyAiError(err))
                  }
                })()
              }}
            >
              Kitabı indir
            </button>
          ) : null}
          {exportableNotes(notes).length > 0 ? (
            <>
              <button
                type="button"
                className="btn-ghost text-sm"
                title="Sadece AI / not özeti (ayrı PDF)"
                onClick={() => {
                  void downloadNotesPdf(exportableNotes(notes), {
                    bookTitle: bookQuery.data?.title || 'Studium',
                  }).then(() => flash('Not özeti PDF indirildi'))
                }}
              >
                Not özeti
              </button>
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => {
                  downloadNotesMarkdown(exportableNotes(notes), {
                    bookTitle: bookQuery.data?.title || 'Studium',
                  })
                  flash('Markdown indirildi')
                }}
              >
                İndir MD
              </button>
            </>
          ) : null}
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
            {organizeOpen && (workingUrl || pdf.url) && bookId ? (
              <PdfOrganizePanel
                pdfSrc={workingUrl || pdf.url!}
                initialBytes={workingBytes}
                bookId={bookId}
                bookTitle={bookQuery.data?.title || 'PDF'}
                onBytesChange={applyWorkingBytes}
                onClose={() => setOrganizeOpen(false)}
                onSaved={(blob) => {
                  rememberPdf(bookId, blob)
                  void blob.arrayBuffer().then((buf) => {
                    setWorkingBytes(new Uint8Array(buf))
                  })
                  setPdfRefresh((n) => n + 1)
                  setReaderPage(1)
                  setViewMode('original')
                  setMobilePane('pdf')
                  flash('PDF güncellendi')
                  void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
                }}
              />
            ) : null}

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
                    textStyle: draftCite.payload.textStyle,
                  })
                  setDraftCite(null)
                  refreshNotes()
                  flash(`${citationStyleLabel(style)} panoya + notlara eklendi`)
                }}
              />
            )}

            <PdfAiPanel
              chapterId={insertChapterId || 'book'}
              chapterTitle={bookQuery.data?.title || 'PDF'}
              payload={sel}
              mode={mode}
              onClose={() => {
                setSel(null)
                setMode(null)
              }}
              onSaveToBook={(body, question) => {
                if (!sel || !mode) {
                  flash('Önce PDF’den metin seç')
                  throw new Error('Seçim yok')
                }
                saveAiToPdf({
                  payload: sel,
                  mode,
                  body,
                  question,
                })
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
                      Metin seç → <strong>Değiştir</strong> /{' '}
                      <strong>Sansür</strong> / Vurgu
                    </li>
                    <li>
                      ⋯ : AI, not, cite, alt/üst çiz, kopyala
                    </li>
                    <li>
                      <strong>PDF düzenle</strong> = sayfa sil / sırala / birleştir
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
