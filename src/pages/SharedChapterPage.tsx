import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPublicBook, fetchPublicChapter } from '@/lib/api'
import AppShell from '@/components/AppShell'
import ExplanationWithInlineChat from '@/components/ExplanationWithInlineChat'
import GroupChatPanel from '@/components/GroupChatPanel'
import ContributionComposer from '@/components/ContributionComposer'
import ContributionReviewPanel from '@/components/ContributionReviewPanel'
import MarkdownWithTts from '@/components/MarkdownWithTts'
import QuizPlayer from '@/components/QuizPlayer'
import ShareStats from '@/components/ShareStats'
import { useStudySession } from '@/hooks/useStudySession'
import {
  fetchMyMembership,
  fetchStudyGroupByBook,
  roleAtLeast,
  roleLabel,
} from '@/lib/studyGroup'

type Depth = 'brief' | 'standard' | 'detailed'
type Tab = 'explanation' | 'examples' | 'quiz'

export default function SharedChapterPage() {
  const { token, chapterId } = useParams<{ token: string; chapterId: string }>()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('explanation')
  const [depth, setDepth] = useState<Depth>('standard')

  const bookQuery = useQuery({
    queryKey: ['public-book', token],
    queryFn: () => fetchPublicBook(token!),
    enabled: !!token,
    retry: false,
  })

  useStudySession(bookQuery.data?.id, chapterId)

  const chapterQuery = useQuery({
    queryKey: ['public-chapter', chapterId, bookQuery.data?.id],
    queryFn: () => fetchPublicChapter(chapterId!, bookQuery.data!.id),
    enabled: !!chapterId && !!bookQuery.data?.id,
    retry: false,
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

  const ch = chapterQuery.data
  const membership = membershipQuery.data
  const canWrite = roleAtLeast(membership?.role, 'write')

  function refreshChapter() {
    void queryClient.invalidateQueries({
      queryKey: ['public-chapter', chapterId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['public-chapters', bookQuery.data?.id],
    })
  }

  const markdown = useMemo(() => {
    if (!ch) return ''
    if (depth === 'brief') return ch.explanation_brief || ch.explanation || ''
    if (depth === 'detailed') {
      return ch.explanation_detailed || ch.explanation || ''
    }
    return ch.explanation || ''
  }, [ch, depth])

  if (bookQuery.isLoading || chapterQuery.isLoading) {
    return (
      <AppShell>
        <p className="muted">Yükleniyor…</p>
      </AppShell>
    )
  }

  if (!bookQuery.data || !ch) {
    return (
      <AppShell>
        <div className="surface-panel mx-auto max-w-lg p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">
            İçerik bulunamadı
          </h1>
          <Link to={token ? `/s/${token}` : '/'} className="btn-primary mt-6 inline-flex">
            Geri dön
          </Link>
        </div>
      </AppShell>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'explanation', label: 'Konu Anlatımı' },
    { id: 'examples', label: 'Örnekler' },
    { id: 'quiz', label: 'Quiz' },
  ]

  const depths: { id: Depth; label: string }[] = [
    { id: 'brief', label: 'Hızlı özet' },
    { id: 'standard', label: 'Genel' },
    { id: 'detailed', label: 'Detay' },
  ]

  return (
    <AppShell>
      <header className="mb-7 space-y-3">
        <Link to={`/s/${token}`} className="btn-ghost">
          ← Paylaşılan çalışmaya dön
        </Link>
        <p
          className="text-xs font-semibold tracking-[0.18em] uppercase"
          style={{ color: 'var(--accent)' }}
        >
          {bookQuery.data.title}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {ch.title}
        </h1>
        {bookQuery.data && (
          <ShareStats
            viewCount={bookQuery.data.view_count}
            shareCount={bookQuery.data.share_count}
          />
        )}
        {ch.summary && (
          <p className="muted max-w-2xl text-sm leading-relaxed">{ch.summary}</p>
        )}
        {membership ? (
          <p className="muted text-xs">
            {membership.display_name} · {roleLabel(membership.role)}
            {canWrite ? ' · içerik ekleyebilirsin' : ''}
          </p>
        ) : (
          <p className="muted text-xs">Okuma modu · quiz’i çözüp skor alabilirsin</p>
        )}
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`chip ${tab === t.id ? 'chip-active' : 'chip-idle'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="surface-panel p-5 sm:p-7">
        {tab === 'explanation' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {depths.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDepth(d.id)}
                  className={`chip ${depth === d.id ? 'chip-active' : 'chip-idle'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {markdown ? (
              canWrite ? (
                <ExplanationWithInlineChat
                  chapterId={ch.id}
                  chapterTitle={ch.title}
                  markdown={markdown}
                  depth={depth}
                  onMarkdownSaved={() => {
                    void queryClient.invalidateQueries({
                      queryKey: ['public-chapter', chapterId],
                    })
                  }}
                />
              ) : (
                <MarkdownWithTts markdown={markdown} />
              )
            ) : (
              <p className="muted text-sm">Bu seviye için içerik yok.</p>
            )}
          </div>
        )}

        {tab === 'examples' && (
          <div className="space-y-5">
            {(ch.examples ?? []).length === 0 && (
              <p className="muted">Örnek yok.</p>
            )}
            {(ch.examples ?? []).map((ex, i) => (
              <div key={i}>
                <p className="font-display font-semibold">
                  Örnek {i + 1}: {ex.problem}
                </p>
                <ol className="muted mt-2 list-decimal space-y-1 pl-5 text-sm">
                  {(ex.solution_steps ?? []).map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {tab === 'quiz' && <QuizPlayer quiz={ch.quiz ?? []} />}
      </section>

      {(canWrite || membership) && (
        <div className="mt-6 space-y-4">
          {membership && canWrite && groupQuery.data && (
            <ContributionComposer
              groupId={groupQuery.data.id}
              chapterId={ch.id}
              chapterTitle={ch.title}
              membership={membership}
              contextExcerpt={(ch.explanation || '').slice(0, 1200)}
              onApplied={refreshChapter}
            />
          )}
          {membership && (
            <ContributionReviewPanel
              chapterId={ch.id}
              membership={membership}
              onApplied={refreshChapter}
            />
          )}
        </div>
      )}

      {groupQuery.data && (
        <div className="mt-6">
          <GroupChatPanel
            groupId={groupQuery.data.id}
            chapterId={ch.id}
            membership={membership ?? null}
            title="Ünite sohbeti"
          />
        </div>
      )}
    </AppShell>
  )
}
