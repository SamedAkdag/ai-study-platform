import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPublicBook,
  fetchPublicChapters,
  recordPublicBookView,
} from '@/lib/api'
import AppShell from '@/components/AppShell'
import {
  fetchMyMembership,
  fetchStudyGroupByBook,
  joinPublicBookAsReader,
  roleLabel,
} from '@/lib/studyGroup'
import GroupChatPanel from '@/components/GroupChatPanel'
import ResharePanel from '@/components/ResharePanel'
import ShareStats from '@/components/ShareStats'
import { rememberLibraryBook } from '@/lib/library'
import { useAuth } from '@/lib/auth'
import {
  chapterProgressLabel,
  getBookProgress,
  summarizeBookProgress,
} from '@/lib/studyProgress'
import { asError } from '@/lib/errors'

export default function SharedBookPage() {
  const { token } = useParams<{ token: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [joinName, setJoinName] = useState('')
  const [joinNote, setJoinNote] = useState<string | null>(null)

  const bookQuery = useQuery({
    queryKey: ['public-book', token],
    queryFn: () => fetchPublicBook(token!),
    enabled: !!token,
    retry: false,
  })

  useEffect(() => {
    const b = bookQuery.data
    if (!b) return
    rememberLibraryBook({
      bookId: b.id,
      title: b.title,
      shareToken: b.share_token,
      source: 'shared',
    })
    void recordPublicBookView(b.id).then(() => {
      void bookQuery.refetch()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per loaded book
  }, [bookQuery.data?.id])

  const chaptersQuery = useQuery({
    queryKey: ['public-chapters', bookQuery.data?.id],
    queryFn: () => fetchPublicChapters(bookQuery.data!.id),
    enabled: !!bookQuery.data?.id,
  })

  const groupQuery = useQuery({
    queryKey: ['study-group-by-book', bookQuery.data?.id],
    queryFn: () => fetchStudyGroupByBook(bookQuery.data!.id),
    enabled: !!bookQuery.data?.id,
  })

  const membershipQuery = useQuery({
    queryKey: ['group-me', groupQuery.data?.id],
    queryFn: () => fetchMyMembership(groupQuery.data!.id),
    enabled: !!groupQuery.data?.id,
  })

  const joinMutation = useMutation({
    mutationFn: () =>
      joinPublicBookAsReader(bookQuery.data!.id, joinName.trim() || undefined),
    onSuccess: async () => {
      setJoinNote('Gruba okuyucu olarak katıldın ✓')
      await queryClient.invalidateQueries({
        queryKey: ['group-me', groupQuery.data?.id],
      })
      await queryClient.invalidateQueries({ queryKey: ['my-library'] })
    },
    onError: (err) => setJoinNote(asError(err).message),
  })

  if (bookQuery.isLoading) {
    return (
      <AppShell>
        <p className="muted">Paylaşılan çalışma yükleniyor…</p>
      </AppShell>
    )
  }

  if (bookQuery.isError || !bookQuery.data) {
    return (
      <AppShell>
        <div className="surface-panel mx-auto max-w-lg p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">
            Link geçersiz veya kapalı
          </h1>
          <p className="muted mt-2 text-sm">
            Bu çalışma artık paylaşılmıyor olabilir (private yapılmış olabilir).
          </p>
          <Link to="/" className="btn-primary mt-6 inline-flex">
            Studium’a git
          </Link>
        </div>
      </AppShell>
    )
  }

  const book = bookQuery.data
  const chapters = chaptersQuery.data ?? []
  const membership = membershipQuery.data
  const canReshare = !!book.is_public && !!book.share_token
  const firstChapter = chapters[0]
  const progress = summarizeBookProgress(
    book.id,
    chapters.map((c) => c.id),
  )
  const progressMap = getBookProgress(book.id)

  return (
    <AppShell wide>
      <header className="mb-8 space-y-3">
        <p className="section-label">Paylaşılan kitap</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {book.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="muted text-sm">
            {chapters.length} ünite
            {book.subject ? ` · ${book.subject}` : ''}
            {progress.total > 0
              ? ` · ${progress.opened}/${progress.total} açıldı`
              : ''}
            {progress.remaining > 0 && progress.opened > 0
              ? ` · ${progress.remaining} kaldı`
              : ''}
          </p>
          <ShareStats
            viewCount={book.view_count}
            shareCount={book.share_count}
          />
        </div>
        {membership ? (
          <p className="muted text-xs">
            {membership.display_name} · {roleLabel(membership.role)}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {firstChapter ? (
            <Link
              to={`/s/${token}/chapters/${firstChapter.id}`}
              className="btn-primary"
            >
              {progress.opened > 0 ? 'Okumaya devam et' : 'Okumaya başla'}
            </Link>
          ) : null}
          {!membership && book.is_public && (
            <button
              type="button"
              className="btn-ghost"
              disabled={joinMutation.isPending}
              onClick={() => joinMutation.mutate()}
            >
              Gruba katıl (okuma + sohbet)
            </button>
          )}
        </div>

        {!membership && book.is_public && (
          <div
            className="max-w-md space-y-2 rounded-xl border p-3"
            style={{ borderColor: 'var(--line)' }}
          >
            <p className="muted text-[11px] leading-relaxed">
              <strong>Sadece oku:</strong> üstteki “Okumaya başla”.
              <br />
              <strong>Sohbet / tartışma:</strong> gruba okuyucu olarak katıl.
              Yazma yetkisi için sahibin daveti gerekir.
            </p>
            <input
              className="field !py-1.5 text-xs"
              placeholder="Görünen ad (opsiyonel)"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              maxLength={40}
            />
            {joinNote && <p className="muted text-[11px]">{joinNote}</p>}
          </div>
        )}

        {!user && (
          <p className="muted text-xs">
            İpucu: giriş yaparsan bildirimler, arkadaşlara gönderme ve süreler
            cihazlar arası kalır.
          </p>
        )}

        <div className="max-w-md">
          <ResharePanel
            bookId={book.id}
            bookTitle={book.title}
            shareToken={book.share_token!}
            canReshare={canReshare}
          />
        </div>
      </header>

      <ul className="surface-panel space-y-3 p-4 sm:p-6">
        {chapters.map((ch) => {
          const label = chapterProgressLabel(progressMap[ch.id])
          return (
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
                {label && (
                  <p className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--accent-deep)' }}>
                    {label}
                  </p>
                )}
                {ch.key_concepts && ch.key_concepts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ch.key_concepts.map((t) => (
                      <span key={t} className="subtopic-chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Link
                to={`/s/${token}/chapters/${ch.id}`}
                className="btn-primary shrink-0 self-start sm:self-center"
              >
                Oku
              </Link>
            </li>
          )
        })}
        {chapters.length === 0 && (
          <li className="muted px-2 py-6 text-center text-sm">
            Henüz paylaşılacak üretilmiş ünite yok.
          </li>
        )}
      </ul>

      {groupQuery.data && (
        <div className="mt-6">
          <GroupChatPanel
            groupId={groupQuery.data.id}
            membership={membership ?? null}
            title="Kitap geneli — grup sohbeti"
          />
        </div>
      )}
    </AppShell>
  )
}
