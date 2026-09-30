import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchChapter, generateSingleChapterContent } from '@/lib/api'
import ExplanationWithInlineChat from '@/components/ExplanationWithInlineChat'
import AppShell from '@/components/AppShell'
import QuizPlayer from '@/components/QuizPlayer'
import {
  findRelatedPassages,
  parsePageTextToSources,
  type PageSource,
} from '@/lib/sourceLookup'
import { useStudySession } from '@/hooks/useStudySession'

type Tab = 'explanation' | 'examples' | 'quiz' | 'sources'
type Depth = 'brief' | 'standard' | 'detailed'

export default function ChapterPage() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  useStudySession(bookId, chapterId)
  const [tab, setTab] = useState<Tab>('explanation')
  const [depth, setDepth] = useState<Depth>('standard')
  const [stylePref, setStylePref] = useState(
    'Gerçek dünya örnekleriyle, sade ve anlaşılır anlat',
  )
  const [genError, setGenError] = useState<string | null>(null)
  const [bookHits, setBookHits] = useState<
    Array<{ page: number; excerpt: string; score: number }>
  >([])
  const queryClient = useQueryClient()

  const chapterQuery = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: () => fetchChapter(chapterId!),
    enabled: !!chapterId,
  })

  const generateMutation = useMutation({
    mutationFn: () =>
      generateSingleChapterContent({
        id: chapterQuery.data!.id,
        title: chapterQuery.data!.title,
        style: stylePref.trim(),
      }),
    onSuccess: async () => {
      setGenError(null)
      await queryClient.invalidateQueries({ queryKey: ['chapter', chapterId] })
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
    },
    onError: (err) => {
      setGenError(err instanceof Error ? err.message : 'Üretim başarısız')
      void queryClient.invalidateQueries({ queryKey: ['chapter', chapterId] })
    },
  })

  const ch = chapterQuery.data

  const pageSources: PageSource[] = useMemo(() => {
    if (ch?.page_sources && Array.isArray(ch.page_sources) && ch.page_sources.length) {
      return ch.page_sources as PageSource[]
    }
    if (ch?.page_text) return parsePageTextToSources(ch.page_text)
    return []
  }, [ch?.page_sources, ch?.page_text])

  const markdownForDepth = useMemo(() => {
    if (!ch) return ''
    if (depth === 'brief') return ch.explanation_brief || ch.explanation || ''
    if (depth === 'detailed') {
      return ch.explanation_detailed || ch.explanation || ''
    }
    return ch.explanation || ''
  }, [ch, depth])

  const needsContent =
    !!ch &&
    (ch.status === 'pending' ||
      ch.status === 'failed' ||
      (!ch.explanation && ch.status !== 'generating'))

  const tabs: { id: Tab; label: string }[] = [
    { id: 'explanation', label: 'Konu Anlatımı' },
    { id: 'examples', label: 'Çözümlü Örnekler' },
    { id: 'quiz', label: 'Mini Quiz' },
    { id: 'sources', label: 'PDF Kesitleri' },
  ]

  const depths: { id: Depth; label: string; hint: string }[] = [
    { id: 'brief', label: 'Özet (K1)', hint: '~1–2 dk' },
    { id: 'standard', label: 'Detaylı özet (K2)', hint: '~10–15 dk' },
    { id: 'detailed', label: 'Full detay (K3)', hint: 'sayfa sayfa' },
  ]

  function showInBook(selected: string) {
    const hits = findRelatedPassages(pageSources, selected)
    setBookHits(hits)
    setTab('sources')
  }

  return (
    <AppShell bookId={bookId} showBookTimer>
      <header className="mb-7 space-y-3">
        <Link to={`/books/${bookId}`} className="btn-ghost">
          ← Kitaba dön
        </Link>
        <div>
          <p className="section-label mb-2">Ünite</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {ch?.title || '…'}
          </h1>
          {ch?.summary && (
            <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">
              {ch.summary}
            </p>
          )}
          {ch?.key_concepts && ch.key_concepts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ch.key_concepts.map((t) => (
                <span key={t} className="subtopic-chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {needsContent && ch?.status !== 'generating' && !generateMutation.isPending && (
        <div className="surface-panel space-y-4 p-5 sm:p-7">
          <div className="text-center">
            <p className="font-display text-xl font-semibold">İçerik üret</p>
            <p className="muted mx-auto mt-1.5 max-w-md text-sm">
              Bu ünite için anlatım, örnek ve quiz oluştur.
            </p>
          </div>
          <details className="text-sm">
            <summary className="muted cursor-pointer text-xs font-semibold">
              Anlatım tercihi (opsiyonel)
            </summary>
            <textarea
              value={stylePref}
              onChange={(e) => setStylePref(e.target.value)}
              rows={2}
              placeholder="Örn. basit dilde, sınav odaklı…"
              className="field mt-2"
            />
          </details>
          <div className="text-center">
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              className="btn-primary"
            >
              Üret
            </button>
          </div>
          {genError && <div className="alert-error text-center">{genError}</div>}
        </div>
      )}

      {(ch?.status === 'generating' || generateMutation.isPending) && (
        <div className="alert-info">
          İçerik üretiliyor… Her sayfa kapsanmaya çalışılıyor (özet + genel +
          detay).
        </div>
      )}

      {ch?.status === 'ready' && ch.explanation && (
        <div className="space-y-5">
          {ch.generation_style && (
            <p className="muted text-xs">
              Anlatım stili: {ch.generation_style}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
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
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {depths.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDepth(d.id)}
                      className={`chip ${
                        depth === d.id ? 'chip-active' : 'chip-idle'
                      }`}
                    >
                      {d.label}
                      <span className="ml-1 opacity-70">({d.hint})</span>
                    </button>
                  ))}
                </div>

                {!markdownForDepth ? (
                  <p className="muted text-sm">
                    Bu seviye henüz yok. Yeniden içerik üretebilirsin.
                  </p>
                ) : (
                  <ExplanationWithInlineChat
                    chapterId={ch.id}
                    chapterTitle={ch.title}
                    markdown={markdownForDepth}
                    depth={depth}
                    onMarkdownSaved={() => {
                      void queryClient.invalidateQueries({
                        queryKey: ['chapter', chapterId],
                      })
                    }}
                    onShowInBook={showInBook}
                  />
                )}

                {bookHits.length > 0 && (
                  <div
                    className="rounded-xl border px-4 py-3"
                    style={{
                      borderColor: 'rgba(154, 123, 79, 0.35)',
                      background: 'rgba(154, 123, 79, 0.1)',
                    }}
                  >
                    <p
                      className="text-xs font-semibold"
                      style={{ color: 'var(--gold)' }}
                    >
                      Seçimin kitapta olabilecek yerleri
                    </p>
                    <ul className="mt-2 space-y-2">
                      {bookHits.map((h, i) => (
                        <li key={i} className="text-xs" style={{ color: 'var(--ink)' }}>
                          <span className="font-semibold">s. {h.page}</span>
                          <p className="mt-0.5 whitespace-pre-wrap opacity-90">
                            …{h.excerpt}…
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {tab === 'examples' && (
              <ExamplesPanel examples={ch.examples ?? []} />
            )}

            {tab === 'quiz' && <QuizPlayer quiz={ch.quiz ?? []} />}

            {tab === 'sources' && (
              <SourcesPanel
                sources={pageSources}
                highlight={bookHits}
                onClearHighlight={() => setBookHits([])}
              />
            )}
          </section>

          <div className="space-y-3">
            <label className="block text-sm">
              <span className="muted mb-1.5 block font-medium">
                Stili değiştirip yeniden üret
              </span>
              <textarea
                value={stylePref}
                onChange={(e) => setStylePref(e.target.value)}
                rows={2}
                className="field"
              />
            </label>
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              className="btn-ghost"
            >
              Yeniden üret
            </button>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function SourcesPanel({
  sources,
  highlight,
  onClearHighlight,
}: {
  sources: PageSource[]
  highlight: Array<{ page: number; excerpt: string }>
  onClearHighlight: () => void
}) {
  if (!sources.length) {
    return (
      <p className="muted text-sm">Bu ünite için saklanmış PDF metni yok.</p>
    )
  }

  const highlightPages = new Set(highlight.map((h) => h.page))

  return (
    <div className="space-y-4">
      <p className="muted text-sm leading-relaxed">
        Bunlar kitabından çıkan ham sayfa kesitleri — AI özeti değil. Böylece
        içerik kaybı korkusu azalır; her sayfa burada durur.
      </p>
      {highlight.length > 0 && (
        <button type="button" onClick={onClearHighlight} className="btn-ghost">
          Seçim vurgusunu temizle
        </button>
      )}
      {sources.map((s) => (
        <article
          key={s.page}
          className="rounded-xl border px-4 py-3"
          style={{
            borderColor: highlightPages.has(s.page)
              ? 'rgba(154, 123, 79, 0.4)'
              : 'var(--line)',
            background: highlightPages.has(s.page)
              ? 'rgba(154, 123, 79, 0.1)'
              : 'rgba(255,255,255,0.55)',
          }}
        >
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-sm font-semibold">
              Sayfa {s.page}
            </h3>
            {s.topics?.length > 0 && (
              <p className="muted text-xs">{s.topics.join(' · ')}</p>
            )}
          </header>
          <p className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {s.excerpt || '(bu sayfada çıkarılabilir metin yok)'}
          </p>
        </article>
      ))}
    </div>
  )
}

function ExamplesPanel({
  examples,
}: {
  examples: Array<{ problem: string; solution_steps: string[] }>
}) {
  if (!examples.length) {
    return <p className="muted">Henüz örnek yok.</p>
  }

  return (
    <ol className="space-y-6">
      {examples.map((ex, i) => (
        <li key={i} className="space-y-2">
          <p className="font-display text-lg font-semibold">
            Örnek {i + 1}: {ex.problem}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--ink-muted)' }}>
            {(ex.solution_steps ?? []).map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}
