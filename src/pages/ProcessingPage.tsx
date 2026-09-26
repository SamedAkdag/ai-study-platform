import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'

const STEPS = [
  { key: 'extracting', label: 'Metin çıkarılıyor' },
  { key: 'analyzing', label: 'Sayfa iskeleti okunuyor' },
  { key: 'segmenting', label: 'Konu üniteleri ayrılıyor' },
  { key: 'saving', label: 'Liste kaydediliyor' },
  { key: 'ready', label: 'Hazır' },
] as const

export default function ProcessingPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()

  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => fetchBook(bookId!),
    enabled: !!bookId,
    refetchInterval: (q) =>
      q.state.data?.status === 'ready' || q.state.data?.status === 'failed'
        ? false
        : 1500,
  })

  const chaptersQuery = useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => fetchChapters(bookId!),
    enabled: !!bookId,
    refetchInterval: 2000,
  })

  useEffect(() => {
    if (bookQuery.data?.status === 'ready' && bookId) {
      navigate(`/books/${bookId}`, { replace: true })
    }
  }, [bookQuery.data?.status, bookId, navigate])

  const step = bookQuery.data?.progress_step || 'extracting'
  const stepIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.key === step),
  )
  const chapters = chaptersQuery.data ?? []

  return (
    <AppShell>
      <section className="mx-auto max-w-xl">
        <header className="mb-8">
          <p className="muted text-sm">Hazırlanıyor</p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">
            {bookQuery.data?.title || 'Kitabın işleniyor…'}
          </h1>
          <p className="muted mt-3 text-sm leading-relaxed">
            Her ünite ~15–25 dakikalık tamamlanmış bir konu. Sayfa sayısı sabit
            değil; cümle parçaları başlık olmaz.
          </p>
        </header>

        <ol className="surface-panel space-y-2 p-4">
          {STEPS.filter((s) => s.key !== 'ready').map((s, i) => {
            const done = i < stepIndex || step === 'ready'
            const active = s.key === step
            return (
              <li
                key={s.key}
                className="flex items-center justify-between rounded-xl px-3.5 py-3 text-sm transition"
                style={{
                  background: active
                    ? 'var(--ink)'
                    : done
                      ? 'var(--accent-soft)'
                      : 'transparent',
                  color: active
                    ? '#f7fbff'
                    : done
                      ? 'var(--accent-deep)'
                      : 'var(--ink-muted)',
                }}
              >
                <span>
                  {done && !active ? '✓ ' : active ? '… ' : '○ '}
                  {s.label}
                </span>
                {s.key === 'saving' && chapters.length > 0 && (
                  <span className="text-xs opacity-80">{chapters.length} ünite</span>
                )}
              </li>
            )
          })}
        </ol>

        {bookQuery.data?.status === 'failed' && (
          <div className="alert-error mt-5 space-y-2">
            <p className="font-semibold">İşlem başarısız oldu.</p>
            {bookQuery.data.error_message && (
              <p className="text-xs break-words opacity-90">
                {bookQuery.data.error_message}
              </p>
            )}
            <Link to="/" className="inline-block font-semibold underline">
              Yeniden dene
            </Link>
          </div>
        )}
      </section>
    </AppShell>
  )
}
