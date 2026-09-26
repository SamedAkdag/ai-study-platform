import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'

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
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="space-y-3">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
          ← Yeni kitap
        </Link>
        <h1 className="text-3xl font-semibold text-slate-900">
          {bookQuery.data?.title || '…'}
        </h1>
        <p className="text-sm text-slate-600">
          {chapters.length} ünite
          {bookQuery.data?.subject ? ` · ${bookQuery.data.subject}` : ''}
        </p>
        <p className="text-sm text-slate-500">
          İçerik üniteye tıklayınca üretilir. İlerleme: {ready}/{chapters.length}{' '}
          ünite hazır ({progress}%).
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-slate-900 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          {chapters.map((ch) => (
            <Link
              key={ch.id}
              to={`/books/${bookId}/chapters/${ch.id}`}
              className="block rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm hover:border-slate-400"
            >
              <span className="font-medium text-slate-900">
                {ch.order_index ?? ch.chapter_number}. {ch.title}
              </span>
              {ch.summary && (
                <span className="mt-1 block text-xs leading-snug text-slate-600">
                  {ch.summary}
                </span>
              )}
              {ch.key_concepts && ch.key_concepts.length > 0 && (
                <span className="mt-1.5 block text-[11px] leading-snug text-slate-500">
                  Konular: {ch.key_concepts.join(' · ')}
                </span>
              )}
              <span className="mt-1 block text-xs text-slate-400">
                s. {ch.start_page}–{ch.end_page} · {statusLabel(ch.status)}
              </span>
            </Link>
          ))}
        </aside>

        <main className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Çalışma üniteleri</h2>
          <p className="mt-2 text-sm text-slate-600">
            Her ünite bir konu başlığı ve kısa açıklama içerir. Açınca anlatım,
            örnekler ve quiz üretilebilir.
          </p>
          <ul className="mt-6 space-y-3">
            {chapters.map((ch) => (
              <li
                key={ch.id}
                className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {ch.order_index ?? ch.chapter_number}. {ch.title}
                  </p>
                  {ch.summary && (
                    <p className="mt-1 text-sm text-slate-600">{ch.summary}</p>
                  )}
                  {ch.key_concepts && ch.key_concepts.length > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Konular: </span>
                      {ch.key_concepts.join(' · ')}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    s. {ch.start_page}–{ch.end_page} · {statusLabel(ch.status)}
                  </p>
                </div>
                <Link
                  to={`/books/${bookId}/chapters/${ch.id}`}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                >
                  Aç
                </Link>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  )
}
