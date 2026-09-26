import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'

const STEPS = [
  { key: 'extracting', label: 'Extracting text from PDF…' },
  { key: 'analyzing', label: 'Reading page outlines…' },
  { key: 'segmenting', label: 'Detecting topic-coherent units…' },
  { key: 'saving', label: 'Saving chapter list…' },
  { key: 'ready', label: 'Ready' },
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
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-4 py-12">
      <div>
        <p className="text-sm text-slate-500">İşleniyor</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {bookQuery.data?.title || 'Kitabın hazırlanıyor…'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Her ünite ~15–25 dakikalık tamamlanmış bir konu. Sayfa sayısı sabit
          değil; cümle parçaları başlık olmaz.
        </p>
      </div>

      <ol className="space-y-3">
        {STEPS.filter((s) => s.key !== 'ready').map((s, i) => {
          const done = i < stepIndex || step === 'ready'
          const active = s.key === step
          return (
            <li
              key={s.key}
              className={`rounded-xl px-4 py-3 text-sm ${
                active
                  ? 'bg-slate-900 text-white'
                  : done
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {done && !active ? '✓ ' : active ? '… ' : '○ '}
              {s.label}
              {s.key === 'saving' && chapters.length > 0 && (
                <span className="ml-2 opacity-80">
                  ({chapters.length} ünite)
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {bookQuery.data?.status === 'failed' && (
        <div className="space-y-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">İşlem başarısız oldu.</p>
          {bookQuery.data.error_message && (
            <p className="break-words text-xs opacity-90">
              {bookQuery.data.error_message}
            </p>
          )}
          <Link to="/" className="font-medium underline">
            Yeniden dene
          </Link>
        </div>
      )}
    </div>
  )
}
