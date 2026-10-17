import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'
import ShareBookButton from '@/components/ShareBookButton'
import SendStudyButton from '@/components/SendStudyButton'
import ShareStats from '@/components/ShareStats'
import { useStudySession } from '@/hooks/useStudySession'
import { processBookPipeline } from '@/lib/processBook'
import { friendlyAiError } from '@/lib/errors'
import {
  chapterProgressLabel,
  getBookProgress,
  summarizeBookProgress,
} from '@/lib/studyProgress'
import { pullChapterProgressForBook } from '@/lib/chapterProgressSync'
import {
  fetchWeakChaptersForBook,
  type WeakChapter,
} from '@/lib/quizResults'
import { listDueForBook, pullSrsForBook, type SrsItem } from '@/lib/srs'
import GroupStudyPack from '@/components/GroupStudyPack'
import {
  fetchMyMembership,
  fetchStudyGroupByBook,
} from '@/lib/studyGroup'

function statusLabel(status: string) {
  if (status === 'ready') return 'hazır'
  if (status === 'pending') return 'içerik bekliyor'
  if (status === 'generating') return 'üretiliyor'
  if (status === 'failed') return 'hata'
  return status
}

function SubtopicChips({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="subtopic-chip">
          {t}
        </span>
      ))}
    </div>
  )
}

export default function BookPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  useStudySession(bookId)
  const [shareOpen, setShareOpen] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)
  const [progressTick, setProgressTick] = useState(0)
  const [weak, setWeak] = useState<WeakChapter[]>([])
  const [due, setDue] = useState<SrsItem[]>([])

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

  useEffect(() => {
    if (!bookId) return
    void pullChapterProgressForBook(bookId).then(() =>
      setProgressTick((n) => n + 1),
    )
    void pullSrsForBook(bookId).then(setDue)
  }, [bookId])

  useEffect(() => {
    const ids = (chaptersQuery.data ?? []).map((c) => c.id)
    if (!ids.length) {
      setWeak([])
      return
    }
    void fetchWeakChaptersForBook(ids).then(setWeak)
    if (bookId) setDue(listDueForBook(bookId))
  }, [chaptersQuery.data, progressTick, bookId])

  const unitsMutation = useMutation({
    mutationFn: async () => {
      if (!bookId || !bookQuery.data) throw new Error('Kitap yok')
      await processBookPipeline({
        bookId,
        bookTitle: bookQuery.data.title,
      })
    },
    onSuccess: async () => {
      setUnitError(null)
      await queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
    },
    onError: (err) => setUnitError(friendlyAiError(err)),
  })

  const chapters = chaptersQuery.data ?? []
  const ready = chapters.filter((c) => c.status === 'ready').length
  const progress = chapters.length ? Math.round((ready / chapters.length) * 100) : 0
  const studyProgress = useMemo(
    () =>
      summarizeBookProgress(
        bookId || '',
        chapters.map((c) => c.id),
      ),
    [bookId, chapters, progressTick],
  )
  const progressMap = useMemo(
    () => (bookId ? getBookProgress(bookId) : {}),
    [bookId, progressTick],
  )
  const chapterTitleById = new Map(chapters.map((c) => [c.id, c.title]))
  const isProcessing =
    bookQuery.data?.status === 'processing' || unitsMutation.isPending

  return (
    <AppShell wide bookId={bookId} showBookTimer>
      <div className="book-hub fade-up">
        <header className="book-hub__hero">
          <Link to="/" className="btn-ghost book-hub__back">
            ← Kitaplık
          </Link>
          <h1 className="font-display book-hub__title">
            {bookQuery.data?.title || '…'}
          </h1>
          <p className="muted book-hub__meta text-sm">
            {chapters.length
              ? `${ready}/${chapters.length} ünite hazır`
              : 'Henüz ünite yok — önce PDF’den çalışabilirsin'}
            {bookQuery.data?.subject ? ` · ${bookQuery.data.subject}` : ''}
            {studyProgress.opened > 0
              ? ` · ${studyProgress.opened} açıldı`
              : ''}
            {studyProgress.remaining > 0 && studyProgress.opened > 0
              ? ` · ${studyProgress.remaining} kaldı`
              : ''}
          </p>
          {bookQuery.data && (
            <ShareStats
              className="mt-1.5"
              viewCount={bookQuery.data.view_count}
              shareCount={bookQuery.data.share_count}
            />
          )}
          <div className="book-hub__progress" aria-label="İlerleme">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="muted text-xs">{progress}%</span>
          </div>
          <div className="book-hub__actions">
            <Link to={`/books/${bookId}/read`} className="btn-primary text-sm">
              PDF’den oku
            </Link>
            {chapters.length === 0 && (
              <button
                type="button"
                className="btn-ghost text-sm"
                disabled={isProcessing}
                onClick={() => {
                  navigate(`/processing/${bookId}`)
                  unitsMutation.mutate()
                }}
              >
                {isProcessing ? 'Üniteler oluşuyor…' : 'Konuları oluştur'}
              </button>
            )}
            {bookQuery.data && (
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setShareOpen((v) => !v)}
              >
                {shareOpen ? 'Kapat' : 'Paylaş'}
              </button>
            )}
          </div>
          {unitError && <div className="alert-error mt-3 text-sm">{unitError}</div>}
          {shareOpen && bookQuery.data && (
            <div className="book-hub__share surface-panel mt-4 max-w-lg space-y-3 p-4">
              <ShareBookButton book={bookQuery.data} />
              <div
                className="border-t pt-3"
                style={{ borderColor: 'var(--line)' }}
              >
                <SendStudyButton
                  bookId={bookQuery.data.id}
                  bookTitle={bookQuery.data.title}
                  allowPrivate
                />
              </div>
            </div>
          )}
        </header>

        {groupQuery.data && membershipQuery.data ? (
          <div className="mb-5">
            <GroupStudyPack
              group={groupQuery.data}
              membership={membershipQuery.data}
              chapters={chapters.map((c) => ({ id: c.id, title: c.title }))}
              chapterHref={(id) => `/books/${bookId}/chapters/${id}`}
            />
          </div>
        ) : null}

        {due.length > 0 || weak.length > 0 ? (
          <section
            className="book-hub__srs surface-panel mb-5 p-4"
            aria-label="Bugünkü tekrar"
          >
            <p className="section-label mb-1">Bugünkü tekrar</p>
            <p className="muted mb-3 text-xs">
              Aralıklı tekrar sırası
              {due.length ? ` · ${due.length} ünite` : ''}
              {weak.length && !due.length
                ? ' · düşük quiz skorları'
                : ''}
            </p>
            <ul className="space-y-2">
              {(due.length
                ? due.map((d) => ({
                    chapterId: d.chapterId,
                    meta: d.dueAt,
                    kind: 'due' as const,
                  }))
                : weak.slice(0, 5).map((w) => ({
                    chapterId: w.chapterId,
                    meta: `${w.lastScore}/${w.lastTotal} · ${Math.round(w.bestPct * 100)}%`,
                    kind: 'weak' as const,
                  }))
              )
                .slice(0, 6)
                .map((row) => (
                  <li key={`${row.kind}-${row.chapterId}`}>
                    <Link
                      to={`/books/${bookId}/chapters/${row.chapterId}`}
                      className="flex items-center justify-between gap-3 text-sm font-semibold"
                      style={{ color: 'var(--accent-deep)' }}
                    >
                      <span className="line-clamp-1">
                        {chapterTitleById.get(row.chapterId) || 'Ünite'}
                      </span>
                      <span className="muted shrink-0 text-xs font-medium">
                        {row.kind === 'due' ? 'Sırada' : row.meta}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        <section className="book-hub__units fade-up-delay" aria-label="Üniteler">
          <div className="book-hub__units-head">
            <p className="section-label mb-0">Üniteler</p>
            {chapters.length > 0 ? (
              <p className="muted text-xs">{chapters.length} konu</p>
            ) : null}
          </div>
          <ul className="book-hub__list">
            {chapters.map((ch) => (
              <li key={ch.id}>
                <Link
                  to={`/books/${bookId}/chapters/${ch.id}`}
                  className="unit-link"
                >
                  <span className="unit-link__index" aria-hidden>
                    {ch.order_index ?? ch.chapter_number}
                  </span>
                  <span className="unit-link__main">
                    <span className="font-display block text-[1.02rem] font-semibold">
                      {ch.title}
                    </span>
                    <SubtopicChips items={ch.key_concepts ?? []} />
                    <span className="muted mt-1 block text-[11px]">
                      {statusLabel(ch.status)}
                      {chapterProgressLabel(progressMap[ch.id])
                        ? ` · ${chapterProgressLabel(progressMap[ch.id])}`
                        : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {chapters.length === 0 && (
              <li className="space-y-3 px-2 py-8 text-center">
                <p className="font-display text-lg font-semibold">Henüz ünite yok</p>
                <p className="muted mx-auto max-w-sm text-sm">
                  PDF’den çalışmaya devam et — veya konuları AI ile ayır.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    to={`/books/${bookId}/read`}
                    className="btn-primary text-sm"
                  >
                    PDF’ye dön
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    disabled={isProcessing}
                    onClick={() => {
                      navigate(`/processing/${bookId}`)
                      unitsMutation.mutate()
                    }}
                  >
                    {isProcessing ? 'Oluşuyor…' : 'Konuları oluştur'}
                  </button>
                </div>
              </li>
            )}
          </ul>
        </section>
      </div>
    </AppShell>
  )
}
