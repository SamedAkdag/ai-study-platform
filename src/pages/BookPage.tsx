import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'

function statusLabel(status: string) {
  if (status === 'ready') return 'hazır'
  if (status === 'pending') return 'içerik bekliyor'
  if (status === 'generating') return 'üretiliyor'
  if (status === 'failed') return 'hata'
  return status
}

export default function BookPage() {
  const { bookId } = useParams<{ bookId: string }>()

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
    <AppShell wide>
      <header className="mb-8 space-y-4">
        <Link to="/" className="btn-ghost">
          ← Yeni kitap
        </Link>
        <div>
          <p
            className="mb-2 text-xs font-semibold tracking-[0.18em] uppercase"
            style={{ color: 'var(--accent)' }}
          >
            Çalışma kitabı
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            {bookQuery.data?.title || '…'}
          </h1>
          <p className="muted mt-2 text-sm">
            {chapters.length} ünite
            {bookQuery.data?.subject ? ` · ${bookQuery.data.subject}` : ''}
            {' · '}
            {ready}/{chapters.length} içerik hazır ({progress}%)
          </p>
        </div>
        <div className="progress-track max-w-md">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="surface-panel h-fit p-3">
          <p className="muted mb-2 px-2 text-xs font-semibold tracking-wide uppercase">
            Üniteler
          </p>
          <nav className="space-y-1">
            {chapters.map((ch) => (
              <Link
                key={ch.id}
                to={`/books/${bookId}/chapters/${ch.id}`}
                className="unit-link"
              >
                <span className="font-display block text-[0.98rem] font-semibold">
                  {ch.order_index ?? ch.chapter_number}. {ch.title}
                </span>
                {ch.summary && (
                  <span className="muted mt-1 block text-xs leading-snug">
                    {ch.summary}
                  </span>
                )}
                {ch.key_concepts && ch.key_concepts.length > 0 && (
                  <span
                    className="mt-1.5 block text-[11px] leading-snug"
                    style={{ color: 'var(--accent-deep)' }}
                  >
                    {ch.key_concepts.join(' · ')}
                  </span>
                )}
                <span className="muted mt-1 block text-[11px]">
                  s. {ch.start_page}–{ch.end_page} · {statusLabel(ch.status)}
                </span>
              </Link>
            ))}
          </nav>
        </aside>

        <main className="surface-panel p-6 sm:p-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Çalışma üniteleri
          </h2>
          <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">
            Her ünite bir konu başlığı ve kısa açıklama içerir. Açınca anlatım
            stili seçip 3 seviyeli içerik üretebilirsin.
          </p>

          <ul className="mt-7 space-y-3">
            {chapters.map((ch) => (
              <li
                key={ch.id}
                className="flex flex-col gap-3 rounded-2xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                style={{
                  borderColor: 'var(--line)',
                  background: 'rgba(255,255,255,0.55)',
                }}
              >
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold">
                    {ch.order_index ?? ch.chapter_number}. {ch.title}
                  </p>
                  {ch.summary && (
                    <p className="muted mt-1 text-sm">{ch.summary}</p>
                  )}
                  {ch.key_concepts && ch.key_concepts.length > 0 && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--accent-deep)' }}>
                      <span className="font-semibold">Konular: </span>
                      {ch.key_concepts.join(' · ')}
                    </p>
                  )}
                  <p className="muted mt-1 text-xs">
                    s. {ch.start_page}–{ch.end_page} · {statusLabel(ch.status)}
                  </p>
                </div>
                <Link
                  to={`/books/${bookId}/chapters/${ch.id}`}
                  className="btn-primary shrink-0 self-start sm:self-center"
                >
                  Aç
                </Link>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </AppShell>
  )
}
