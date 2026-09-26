import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchChapter, generateSingleChapterContent } from '@/lib/api'
import ExplanationWithInlineChat from '@/components/ExplanationWithInlineChat'
import AppShell from '@/components/AppShell'
import {
  findRelatedPassages,
  parsePageTextToSources,
  type PageSource,
} from '@/lib/sourceLookup'
import type { QuizItem } from '@/types/database'

type Tab = 'explanation' | 'examples' | 'quiz' | 'sources'
type Depth = 'brief' | 'standard' | 'detailed'

export default function ChapterPage() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
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
    { id: 'brief', label: 'Hızlı özet', hint: '~1–2 dk' },
    { id: 'standard', label: 'Genel anlatım', hint: '~10–15 dk' },
    { id: 'detailed', label: 'Full detay', hint: 'sayfa sayfa' },
  ]

  function showInBook(selected: string) {
    const hits = findRelatedPassages(pageSources, selected)
    setBookHits(hits)
    setTab('sources')
  }

  return (
    <AppShell>
      <header className="mb-7 space-y-3">
        <Link to={`/books/${bookId}`} className="btn-ghost">
          ← Kitaba dön
        </Link>
        <div>
          <p
            className="mb-2 text-xs font-semibold tracking-[0.18em] uppercase"
            style={{ color: 'var(--accent)' }}
          >
            Çalışma ünitesi
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {ch?.title || '…'}
          </h1>
          {ch && (
            <p className="muted mt-2 text-sm">
              s. {ch.start_page}–{ch.end_page} · {ch.status}
              {pageSources.length > 0
                ? ` · ${pageSources.length} sayfa kaynağı`
                : ''}
            </p>
          )}
          {ch?.summary && (
            <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">
              {ch.summary}
            </p>
          )}
          {ch?.key_concepts && ch.key_concepts.length > 0 && (
            <p className="mt-2 text-xs" style={{ color: 'var(--accent-deep)' }}>
              <span className="font-semibold">Konular: </span>
              {ch.key_concepts.join(' · ')}
            </p>
          )}
        </div>
      </header>

      {needsContent && ch?.status !== 'generating' && !generateMutation.isPending && (
        <div className="surface-panel space-y-5 border-dashed p-6 sm:p-8">
          <div className="text-center">
            <p className="font-display text-xl font-semibold">
              Materyal henüz hazır değil
            </p>
            <p className="muted mx-auto mt-2 max-w-md text-sm leading-relaxed">
              Sayfalar kaynaktan okunarak 3 seviyeli anlatım, örnekler ve quiz
              üretilecek.
            </p>
          </div>
          <label className="block text-sm">
            <span className="muted mb-1.5 block font-medium">
              Anlatım tercihin (opsiyonel)
            </span>
            <textarea
              value={stylePref}
              onChange={(e) => setStylePref(e.target.value)}
              rows={2}
              placeholder="Örn. gerçek dünya örnekleriyle, basit dilde, sınav odaklı…"
              className="field"
            />
          </label>
          <div className="text-center">
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              className="btn-primary"
            >
              Bu ünite için içerik üret
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

            {tab === 'quiz' && <QuizPanel quiz={ch.quiz ?? []} />}

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

function QuizPanel({ quiz }: { quiz: QuizItem[] }) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)

  const score = useMemo(() => {
    if (!submitted) return null
    let ok = 0
    quiz.forEach((q, i) => {
      if (answers[i] === q.correct_index) ok += 1
    })
    return { ok, total: quiz.length }
  }, [answers, quiz, submitted])

  if (!quiz.length) {
    return <p className="muted">Henüz quiz yok.</p>
  }

  return (
    <div className="space-y-6">
      {quiz.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="font-display font-semibold">
            {i + 1}. {q.question}
          </p>
          <div className="space-y-1.5">
            {q.options.map((opt, oi) => {
              const selected = answers[i] === oi
              let border = 'var(--line)'
              let bg = 'rgba(255,255,255,0.55)'
              if (submitted) {
                if (oi === q.correct_index) {
                  border = 'rgba(13, 92, 86, 0.45)'
                  bg = 'var(--accent-soft)'
                } else if (selected) {
                  border = 'rgba(155, 44, 44, 0.4)'
                  bg = 'var(--danger-soft)'
                }
              } else if (selected) {
                border = 'var(--ink)'
                bg = 'rgba(16, 32, 51, 0.04)'
              }
              return (
                <button
                  key={oi}
                  type="button"
                  disabled={submitted}
                  onClick={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                  className="block w-full rounded-xl border px-3 py-2.5 text-left text-sm transition"
                  style={{ borderColor: border, background: bg }}
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {submitted && (
            <p className="muted text-xs">{q.explanation}</p>
          )}
        </div>
      ))}

      {!submitted ? (
        <button
          type="button"
          onClick={() => setSubmitted(true)}
          className="btn-primary"
        >
          Kontrol et
        </button>
      ) : (
        <p className="font-display text-lg font-semibold">
          Skor: {score?.ok}/{score?.total}
        </p>
      )}
    </div>
  )
}
