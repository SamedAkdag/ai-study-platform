import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'
import ShareBookButton from '@/components/ShareBookButton'
import SendStudyButton from '@/components/SendStudyButton'
import ShareStats from '@/components/ShareStats'
import { useStudySession } from '@/hooks/useStudySession'

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
  useStudySession(bookId)
  const [shareOpen, setShareOpen] = useState(false)

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

  const chapters = chaptersQuery.data ?? []
  const ready = chapters.filter((c) => c.status === 'ready').length
  const progress = chapters.length ? Math.round((ready / chapters.length) * 100) : 0

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
            {ready}/{chapters.length || '…'} ünite hazır
            {bookQuery.data?.subject ? ` · ${bookQuery.data.subject}` : ''}
          </p>
          {bookQuery.data && (
            <ShareStats
              className="mt-1.5"
              viewCount={bookQuery.data.view_count}
              shareCount={bookQuery.data.share_count}
            />
          )}
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
                </span>
              </Link>
            </li>
          ))}
          {chapters.length === 0 && (
            <li className="muted px-2 py-6 text-center text-sm">
              Ünite henüz yok.
            </li>
          )}
        </ul>
      </div>
    </AppShell>
  )
}
