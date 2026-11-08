import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'
import LessonWaitMood from '@/components/LessonWaitMood'
import { friendlyAiError } from '@/lib/errors'
import { processBookPipeline } from '@/lib/processBook'
import {
  describeUnitScope,
  peekUnitScope,
  stashUnitScope,
} from '@/lib/unitScope'

const STEPS = [
  { key: 'extracting', label: 'PDF metni hazır' },
  { key: 'analyzing', label: 'Sayfalar taranıyor' },
  { key: 'segmenting', label: 'MiMo alt başlık + ünite gruplama' },
  { key: 'saving', label: 'Liste kaydediliyor' },
  { key: 'ready', label: 'Hazır' },
] as const

export default function ProcessingPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const nextStudy = searchParams.get('next') === 'study'

  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => fetchBook(bookId!),
    enabled: !!bookId,
    refetchInterval: (q) =>
      q.state.data?.status === 'ready' || q.state.data?.status === 'failed'
        ? false
        : 1000,
  })

  const chaptersQuery = useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => fetchChapters(bookId!),
    enabled: !!bookId,
    refetchInterval: 2000,
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!bookId || !bookQuery.data) throw new Error('Kitap yok')
      setRetryNote(null)
      const scope = peekUnitScope(bookId) || { mode: 'all' as const }
      stashUnitScope(bookId, scope)
      await processBookPipeline({
        bookId,
        bookTitle: bookQuery.data.title,
        scope,
      })
    },
    onSuccess: async () => {
      setRetryNote(null)
      await queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
    },
    onError: (err) => setRetryNote(friendlyAiError(err)),
  })

  useEffect(() => {
    if (!bookQuery.data || !bookId) return
    if (bookQuery.data.status !== 'ready') return
    // After upload (?next=study) or unit split → study desk
    if (nextStudy || bookQuery.data.progress_step === 'imported') {
      navigate(`/study/${bookId}`, { replace: true })
      return
    }
    navigate(`/study/${bookId}`, { replace: true })
  }, [
    bookQuery.data?.status,
    bookQuery.data?.progress_step,
    bookId,
    navigate,
    nextStudy,
  ])

  if (bookQuery.isError) {
    return (
      <AppShell>
        <section className="mx-auto max-w-xl space-y-4">
          <h1 className="font-display text-2xl font-semibold">
            Kitap yüklenemedi
          </h1>
          <p className="muted text-sm">{friendlyAiError(bookQuery.error)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void bookQuery.refetch()}
            >
              Tekrar dene
            </button>
            <Link to="/library" className="btn-ghost">
              Kitaplığım
            </Link>
          </div>
        </section>
      </AppShell>
    )
  }

  const step = bookQuery.data?.progress_step || 'extracting'
  const stepIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.key === step),
  )
  const chapters = chaptersQuery.data ?? []
  const live = bookQuery.data?.error_message
  const failed = bookQuery.data?.status === 'failed'
  const retrying = retryMutation.isPending

  return (
    <AppShell>
      <section className="mx-auto max-w-xl">
        <header className="mb-8">
          <p className="muted text-sm">Hazırlanıyor</p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">
            Kaynağın hazırlanıyor…
          </h1>
          <p className="muted mt-3 text-sm leading-relaxed">
            {bookQuery.data?.title || 'Studium kaynağını hazırlıyor'}
          </p>
          {bookId && peekUnitScope(bookId) ? (
            <p className="muted mt-2 text-xs font-semibold">
              Kapsam: {describeUnitScope(peekUnitScope(bookId)!)}
            </p>
          ) : null}
          {!failed ? (
            <div className="mt-4">
              <LessonWaitMood
                kind="processing"
                size="banner"
                detail={live || STEPS.find((s) => s.key === step)?.label || null}
              />
            </div>
          ) : null}
        </header>

        <ol className="surface-panel space-y-2 p-4">
          {STEPS.filter((s) => s.key !== 'ready').map((s, i) => {
            const done = i < stepIndex || step === 'ready'
            const active = (s.key === step && !failed) || (retrying && i === 0)
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
                  <span className="text-xs opacity-80">
                    {chapters.length} ünite
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        {!failed && live && (
          <div className="alert-info mt-5 break-words">
            <p className="text-xs font-semibold tracking-wide uppercase">
              Canlı durum
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{live}</p>
          </div>
        )}

        {failed && (
          <div className="alert-error mt-5 space-y-3">
            <p className="font-semibold">İşlem başarısız oldu</p>
            {live ? (
              <p className="text-xs break-words whitespace-pre-wrap opacity-95">
                {live}
              </p>
            ) : null}
            {retryNote ? (
              <p className="text-xs break-words whitespace-pre-wrap opacity-95">
                {retryNote}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={retrying || !bookQuery.data}
                onClick={() => retryMutation.mutate()}
              >
                {retrying ? 'Yeniden başlıyor…' : 'Ünite ayırmayı tekrar dene'}
              </button>
              <Link
                to={bookId ? `/books/${bookId}/read` : '/'}
                className="btn-ghost text-sm"
              >
                PDF’den devam et
              </Link>
              <Link to="/library" className="btn-ghost text-sm">
                Kitaplığım
              </Link>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  )
}
