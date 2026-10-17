import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPublicBook,
  fetchPublicChapter,
  fetchPublicChapters,
  practiceDifficultyLabel,
  type PracticeDifficulty,
} from '@/lib/api'
import type { ExampleItem, QuizItem } from '@/types/database'
import AppShell from '@/components/AppShell'
import ContributePanel from '@/components/ContributeDrawer'
import ContributionReviewPanel from '@/components/ContributionReviewPanel'
import StudyLeftNav from '@/components/study/StudyLeftNav'
import StudyRightStudio, {
  type ReadStudioTab,
} from '@/components/study/StudyRightStudio'
import MindMapPanel, { mindMapFromConcepts } from '@/components/MindMapPanel'
import FlashcardStories from '@/components/FlashcardStories'
import StudyGuidePanel from '@/components/StudyGuidePanel'
import AudioOverviewPanel from '@/components/AudioOverviewPanel'
import GroupChatPanel from '@/components/GroupChatPanel'
import QuizPlayer from '@/components/QuizPlayer'
import PracticeMoreBar from '@/components/PracticeMoreBar'
import ShareStats from '@/components/ShareStats'
import { useStudySession } from '@/hooks/useStudySession'
import { postGroupMessage } from '@/lib/groupChat'
import { markChapterOpened, markChapterQuiz } from '@/lib/studyProgress'
import {
  fetchMyMembership,
  fetchStudyGroupByBook,
  roleAtLeast,
  roleLabel,
} from '@/lib/studyGroup'

const ExplanationWithInlineChat = lazy(
  () => import('@/components/ExplanationWithInlineChat'),
)

type Depth = 'brief' | 'standard' | 'detailed'
type StudyMode = 'read' | 'practice'
type PracticePanel = 'flash' | 'examples' | 'quiz'

export default function SharedChapterPage() {
  const { token, chapterId } = useParams<{ token: string; chapterId: string }>()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<StudyMode>('read')
  const [practicePanel, setPracticePanel] = useState<PracticePanel>('quiz')
  const [practiceDifficulty, setPracticeDifficulty] =
    useState<PracticeDifficulty>('medium')
  const [extraQuiz, setExtraQuiz] = useState<QuizItem[]>([])
  const [extraExamples, setExtraExamples] = useState<ExampleItem[]>([])
  const [depth, setDepth] = useState<Depth>('standard')
  const [contributeOpen, setContributeOpen] = useState(false)
  const [flashOpen, setFlashOpen] = useState(false)
  const [readStudio, setReadStudio] = useState<ReadStudioTab | null>(null)

  const bookQuery = useQuery({
    queryKey: ['public-book', token],
    queryFn: () => fetchPublicBook(token!),
    enabled: !!token,
    retry: false,
  })

  useStudySession(bookQuery.data?.id, chapterId)

  useEffect(() => {
    if (bookQuery.data?.id && chapterId) {
      markChapterOpened(bookQuery.data.id, chapterId)
    }
  }, [bookQuery.data?.id, chapterId])

  const chapterQuery = useQuery({
    queryKey: ['public-chapter', chapterId, bookQuery.data?.id],
    queryFn: () => fetchPublicChapter(chapterId!, bookQuery.data!.id),
    enabled: !!chapterId && !!bookQuery.data?.id,
    retry: false,
  })

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

  const mindMap = useMemo(() => {
    if (!ch) return null
    if (ch.mind_map?.branches?.length) return ch.mind_map
    return mindMapFromConcepts(ch.title, ch.key_concepts ?? [])
  }, [ch])

  useEffect(() => {
    setExtraQuiz([])
    setExtraExamples([])
    setPracticeDifficulty('medium')
  }, [chapterId])

  const practiceContext = useMemo(() => {
    if (!ch) return ''
    const concepts = (ch.key_concepts ?? []).slice(0, 8).join(', ')
    const body = (markdown || ch.explanation || ch.summary || '').slice(0, 2800)
    return [ch.summary, concepts ? `Kavramlar: ${concepts}` : '', body]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3200)
  }, [ch, markdown])

  const combinedQuiz = useMemo(
    () => [...(ch?.quiz ?? []), ...extraQuiz],
    [ch?.quiz, extraQuiz],
  )
  const combinedExamples = useMemo(
    () => [...(ch?.examples ?? []), ...extraExamples],
    [ch?.examples, extraExamples],
  )

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

  const modes: { id: StudyMode; label: string }[] = [
    { id: 'read', label: 'Anlatım' },
    { id: 'practice', label: 'Alıştır' },
  ]

  const depths: { id: Depth; label: string }[] = [
    { id: 'brief', label: 'Özet' },
    { id: 'standard', label: 'Genel' },
    { id: 'detailed', label: 'Detay' },
  ]

  const navChapters = (chaptersQuery.data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    href: `/s/${token}/chapters/${c.id}`,
    ready: true,
  }))

  return (
    <AppShell
      bookId={bookQuery.data.id}
      showBookTimer
      studyContext={
        <div className="study-crumb" aria-label="Konum">
          <Link to={`/s/${token}`} className="study-crumb__book">
            {bookQuery.data.title}
          </Link>
          <span className="study-crumb__sep" aria-hidden>
            /
          </span>
          <span className="study-crumb__chapter">{ch.title}</span>
        </div>
      }
    >
      <StudyLeftNav
        bookTitle={bookQuery.data.title}
        bookHref={`/s/${token}`}
        chapters={navChapters}
        activeChapterId={chapterId}
      />

      <StudyRightStudio
        showStudio={mode === 'read'}
        active={readStudio}
        onChange={setReadStudio}
        hasMap={!!mindMap}
        tools={[
          {
            id: 'flash',
            label: 'Flash',
            title: 'Flash Stories’i aç',
            active: flashOpen,
            onClick: () => {
              setContributeOpen(false)
              setMode('practice')
              setPracticePanel('flash')
              setFlashOpen(true)
            },
          },
          {
            id: 'contribute',
            label: 'Ekle',
            title: 'İçerik ekle',
            active: contributeOpen,
            hidden: !(canWrite && groupQuery.data),
            onClick: () => setContributeOpen((v) => !v),
          },
        ]}
        panelOpen={
          !!(contributeOpen && canWrite && membership && groupQuery.data)
        }
        panelTitle="İçerik ekle"
        panelWide
        onClosePanel={() => setContributeOpen(false)}
        panel={
          membership && canWrite && groupQuery.data ? (
            <ContributePanel
              groupId={groupQuery.data.id}
              chapterId={ch.id}
              chapterTitle={ch.title}
              membership={membership}
              contextExcerpt={(ch.explanation || markdown || '').slice(0, 1200)}
              onApplied={refreshChapter}
            />
          ) : null
        }
      />

      <header className="chapter-hero chapter-hero--study">
        <div className="chapter-toolbar">
          <div
            className="mode-segment mode-segment--primary"
            role="tablist"
            aria-label="Çalışma modu"
          >
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => {
                  setMode(m.id)
                  if (m.id !== 'read') setReadStudio(null)
                  if (m.id === 'practice') {
                    setPracticePanel('quiz')
                    setFlashOpen(false)
                  }
                }}
                className={`chip ${mode === m.id ? 'chip-active' : 'chip-idle'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'read' && (
            <div
              className="mode-segment mode-segment--secondary"
              role="tablist"
              aria-label="Anlatım derinliği"
            >
              {depths.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  aria-selected={depth === d.id}
                  onClick={() => setDepth(d.id)}
                  className={`chip ${depth === d.id ? 'chip-active' : 'chip-idle'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="chapter-hero__title">
          <h1 className="font-display font-semibold tracking-tight">
            {ch.title}
          </h1>
          {bookQuery.data && (
            <div className="mt-2">
              <ShareStats
                viewCount={bookQuery.data.view_count}
                shareCount={bookQuery.data.share_count}
              />
            </div>
          )}
          {ch.summary && (
            <p className="muted mt-2 max-w-2xl text-sm leading-relaxed line-clamp-2">
              {ch.summary}
            </p>
          )}
          {membership ? (
            <p className="muted mt-1.5 text-xs">
              {membership.display_name} · {roleLabel(membership.role)}
              {canWrite ? ' · içerik ekleyebilirsin' : ''}
            </p>
          ) : (
            <p className="muted mt-1.5 text-xs">
              Okuma modu · quiz’i çözüp skor alabilirsin
            </p>
          )}
        </div>
      </header>

      {mode === 'read' && (
        <div className="chapter-read">
          {readStudio === 'map' && mindMap ? (
            <section
              className="studio-stage studio-stage--map"
              aria-label="Konu haritası"
            >
              <MindMapPanel
                data={mindMap}
                title={ch.title}
                markdown={markdown}
              />
            </section>
          ) : null}

          {readStudio === 'guide' ? (
            <section className="studio-stage" aria-label="Çalışma kılavuzu">
              <StudyGuidePanel
                title={ch.title}
                summary={ch.summary}
                keyConcepts={ch.key_concepts}
                markdown={markdown}
                quiz={ch.quiz}
                defaultOpen
                onOpenQuiz={() => {
                  setReadStudio(null)
                  setMode('practice')
                  setPracticePanel('quiz')
                  setFlashOpen(false)
                }}
              />
            </section>
          ) : null}

          {readStudio === 'audio' ? (
            <section className="studio-stage" aria-label="Sesli özet">
              <AudioOverviewPanel
                title={ch.title}
                summary={ch.summary}
                keyConcepts={ch.key_concepts}
                markdown={markdown}
                defaultOpen
              />
            </section>
          ) : null}

          {readStudio === null ? (
            <section className="chapter-prose">
              {markdown ? (
                <Suspense
                  fallback={
                    <p className="muted text-sm">Anlatım yükleniyor…</p>
                  }
                >
                  <ExplanationWithInlineChat
                    chapterId={ch.id}
                    chapterTitle={ch.title}
                    markdown={markdown}
                    depth={depth}
                    onMarkdownSaved={refreshChapter}
                  />
                </Suspense>
              ) : (
                <p className="muted text-sm">Bu seviye için içerik yok.</p>
              )}
              {membership && groupQuery.data ? (
                <div className="mt-6">
                  <GroupChatPanel
                    groupId={groupQuery.data.id}
                    chapterId={ch.id}
                    membership={membership}
                    title="Ünite sohbeti"
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      {mode === 'practice' && (
        <div className="chapter-practice">
          <p className="muted text-xs">
            Sınav soruları, çözümlü örnekler ve isteğe bağlı Flash.
          </p>
          <div
            className="mode-segment mode-segment--secondary"
            role="tablist"
            aria-label="Alıştır paneli"
          >
            {(
              [
                ['quiz', 'Sınav'],
                ['examples', 'Çözümlü'],
                ['flash', 'Flash'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={practicePanel === id}
                className={`chip ${practicePanel === id ? 'chip-active' : 'chip-idle'}`}
                onClick={() => {
                  setPracticePanel(id)
                  setFlashOpen(false)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {practicePanel === 'quiz' && (
            <section className="surface-panel p-5 sm:p-8">
              <div className="mb-4">
                <p className="section-label mb-1">Ünite sınavı</p>
                <p className="font-display text-lg font-semibold tracking-tight">
                  Soru çöz · skor al
                </p>
              </div>
              <QuizPlayer
                quiz={combinedQuiz}
                bookTitle={bookQuery.data.title}
                chapterTitle={ch.title}
                onScored={(ok, total) => {
                  if (bookQuery.data?.id) {
                    markChapterQuiz(bookQuery.data.id, ch.id, ok, total)
                  }
                }}
                onShareScore={
                  membership && groupQuery.data
                    ? async (ok, total) => {
                        await postGroupMessage({
                          groupId: groupQuery.data!.id,
                          chapterId: ch.id,
                          member: membership,
                          body: `Quiz skoru: ${ok}/${total} — “${ch.title}”`,
                        })
                      }
                    : undefined
                }
              />
              <PracticeMoreBar
                kind="quiz"
                chapterTitle={ch.title}
                context={practiceContext}
                avoid={combinedQuiz.map((q) => q.question)}
                difficulty={practiceDifficulty}
                onDifficultyChange={setPracticeDifficulty}
                onGenerated={({ quiz }) => {
                  if (quiz?.length) setExtraQuiz((prev) => [...prev, ...quiz])
                }}
              />
            </section>
          )}
          {practicePanel === 'examples' && (
            <section className="surface-panel p-5 sm:p-8">
              <div className="mb-4">
                <p className="section-label mb-1">Çözümlü örnekler</p>
                <p className="font-display text-lg font-semibold tracking-tight">
                  Adım adım çözüm
                </p>
              </div>
              <div className="space-y-5">
                {combinedExamples.length === 0 && (
                  <div className="study-empty">
                    <p className="study-empty__title">Örnek yok</p>
                    <p className="muted text-xs">
                      Aşağıdan zorluk ve adet seçip yeni çözümlü ekleyebilirsin.
                    </p>
                  </div>
                )}
                {combinedExamples.map((ex, i) => {
                  const diff = practiceDifficultyLabel(ex.difficulty)
                  return (
                    <div key={`${i}-${ex.problem.slice(0, 40)}`}>
                      {diff ? (
                        <p className="muted text-[11px] font-semibold tracking-wide uppercase">
                          <span className="practice-item-diff">{diff}</span>
                        </p>
                      ) : null}
                      <p className="font-display font-semibold">
                        Örnek {i + 1}: {ex.problem}
                      </p>
                      <ol className="muted mt-2 list-decimal space-y-1 pl-5 text-sm">
                        {(ex.solution_steps ?? []).map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  )
                })}
              </div>
              <PracticeMoreBar
                kind="example"
                chapterTitle={ch.title}
                context={practiceContext}
                avoid={combinedExamples.map((ex) => ex.problem)}
                difficulty={practiceDifficulty}
                onDifficultyChange={setPracticeDifficulty}
                onGenerated={({ examples }) => {
                  if (examples?.length)
                    setExtraExamples((prev) => [...prev, ...examples])
                }}
              />
            </section>
          )}
          {practicePanel === 'flash' && (
            <div className="practice-hero surface-panel p-5 sm:p-7">
              <p className="section-label mb-1">Flash Stories</p>
              <p className="font-display text-xl font-semibold tracking-tight">
                Kartlarla hızlı tekrar
              </p>
              <p className="muted mt-2 max-w-md text-sm leading-relaxed">
                Sınavdan önce kısa ısınma.
              </p>
              <button
                type="button"
                className="btn-primary mt-4"
                onClick={() => setFlashOpen(true)}
              >
                Flash’ı başlat
              </button>
            </div>
          )}
        </div>
      )}

      <FlashcardStories
        open={flashOpen}
        onClose={() => setFlashOpen(false)}
        title={ch.title}
        markdown={markdown || ch.explanation || ''}
        keyConcepts={ch.key_concepts}
        quiz={ch.quiz}
        aiFlashcards={ch.flashcards}
      />

      {membership && (
        <div className="mt-6">
          <ContributionReviewPanel
            chapterId={ch.id}
            membership={membership}
            onApplied={refreshChapter}
          />
        </div>
      )}

    </AppShell>
  )
}
