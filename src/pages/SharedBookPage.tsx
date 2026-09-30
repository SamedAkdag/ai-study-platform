import { Link, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchPublicBook,
  fetchPublicChapters,
  recordPublicBookView,
} from '@/lib/api'
import AppShell from '@/components/AppShell'
import {
  fetchMyMembership,
  fetchStudyGroupByBook,
  roleLabel,
} from '@/lib/studyGroup'
import GroupChatPanel from '@/components/GroupChatPanel'
import ResharePanel from '@/components/ResharePanel'
import ShareStats from '@/components/ShareStats'
import { rememberLibraryBook } from '@/lib/library'

export default function SharedBookPage() {
  const { token } = useParams<{ token: string }>()

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
        ))}
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
