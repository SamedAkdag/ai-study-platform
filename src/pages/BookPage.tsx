import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
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
  const studyProgress = summarizeBookProgress(
    bookId || '',
    chapters.map((c) => c.id),
  )
  const progressMap = bookId ? getBookProgress(bookId) : {}
  const isProcessing =
    bookQuery.data?.status === 'processing' || unitsMutation.isPending

  return (
    <AppShell wide bookId={bookId} showBookTimer>
      <header className="mb-7 space-y-3">
        <Link to="/" className="btn-ghost">
          ← Kitaplık
        </Link>
        <div>
          <p className="section-label mb-2">Kitap</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {bookQuery.data?.title || '…'}
          </h1>
          <p className="muted mt-2 text-sm">
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
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/books/${bookId}/read`} className="btn-primary text-sm">
              PDF + AI oku
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
          </div>
          {unitError && <div className="alert-error mt-3 text-sm">{unitError}</div>}
        </div>
        <div className="progress-track max-w-sm">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {bookQuery.data && (
          <div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setShareOpen((v) => !v)}
            >
              {shareOpen ? 'Kapat' : 'Paylaş'}
            </button>
            {shareOpen && (
              <div className="surface-panel mt-3 max-w-lg space-y-3 p-4">
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
          </div>
        )}
      </header>

      <div className="surface-panel p-4 sm:p-6">
        <p className="section-label mb-3 px-1">Üniteler</p>
        <ul className="space-y-1">
          {chapters.map((ch) => (
            <li key={ch.id}>
              <Link
                to={`/books/${bookId}/chapters/${ch.id}`}
                className="unit-link"
              >
                <span className="font-display block text-[1.02rem] font-semibold">
                  {ch.order_index ?? ch.chapter_number}. {ch.title}
                </span>
                <SubtopicChips items={ch.key_concepts ?? []} />
                <span className="muted mt-1 block text-[11px]">
                  {statusLabel(ch.status)}
                  {chapterProgressLabel(progressMap[ch.id])
                    ? ` · ${chapterProgressLabel(progressMap[ch.id])}`
                    : ''}
                </span>
              </Link>
            </li>
          ))}
          {chapters.length === 0 && (
            <li className="space-y-3 px-2 py-6 text-center">
              <p className="muted text-sm">
                Ünite yok. PDF’den çalışmaya devam et — veya konuları AI ile
                ayır.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link to={`/books/${bookId}/read`} className="btn-primary text-sm">
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
      </div>
    </AppShell>
  )
}
