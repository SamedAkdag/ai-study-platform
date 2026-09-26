import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchChapter, generateSingleChapterContent } from '@/lib/api'
import ExplanationWithInlineChat from '@/components/ExplanationWithInlineChat'
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
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <Link
          to={`/books/${bookId}`}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← Kitaba dön
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {ch?.title || '…'}
        </h1>
        {ch && (
          <p className="text-sm text-slate-500">
            s. {ch.start_page}–{ch.end_page} · {ch.status}
            {pageSources.length > 0 ? ` · ${pageSources.length} sayfa kaynağı` : ''}
          </p>
        )}
        {ch?.summary && (
          <p className="mt-2 text-sm text-slate-600">{ch.summary}</p>
        )}
        {ch?.key_concepts && ch.key_concepts.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            Konular: {ch.key_concepts.join(' · ')}
          </p>
        )}
      </div>

      {needsContent && ch?.status !== 'generating' && !generateMutation.isPending && (
        <div className="space-y-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <p className="text-center text-slate-700">
            Bu ünite için çalışma materyali henüz yok. Tüm sayfalar kaynaktan
            okunarak 3 seviyeli anlatım üretilecek.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">
              Anlatım tercihin (opsiyonel)
            </span>
            <textarea
              value={stylePref}
              onChange={(e) => setStylePref(e.target.value)}
              rows={2}
              placeholder="Örn. gerçek dünya örnekleriyle, basit dilde, sınav odaklı…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <div className="text-center">
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
            >
              Bu ünite için içerik üret
            </button>
          </div>
          {genError && (
            <p className="text-center text-sm text-red-600">{genError}</p>
          )}
        </div>
      )}

      {(ch?.status === 'generating' || generateMutation.isPending) && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          İçerik üretiliyor… Her sayfa kapsanmaya çalışılıyor (özet + genel +
          detay).
        </div>
      )}

      {ch?.status === 'ready' && ch.explanation && (
        <>
          {ch.generation_style && (
            <p className="text-xs text-slate-500">
              Anlatım stili: {ch.generation_style}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-full px-4 py-1.5 text-sm ${
                  tab === t.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            {tab === 'explanation' && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {depths.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDepth(d.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs ${
                        depth === d.id
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {d.label}
                      <span className="ml-1 opacity-70">({d.hint})</span>
                    </button>
                  ))}
                </div>

                {!markdownForDepth ? (
                  <p className="text-sm text-slate-500">
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
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-900">
                      Seçimin kitapta olabilecek yerleri
                    </p>
                    <ul className="mt-2 space-y-2">
                      {bookHits.map((h, i) => (
                        <li key={i} className="text-xs text-amber-950">
                          <span className="font-medium">s. {h.page}</span>
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

          {ch.status === 'ready' && (
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              className="text-xs text-slate-500 underline"
            >
              Stili değiştirip yeniden üret
            </button>
          )}
        </>
      )}
    </div>
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
      <p className="text-sm text-slate-500">
        Bu ünite için saklanmış PDF metni yok.
      </p>
    )
  }

  const highlightPages = new Set(highlight.map((h) => h.page))

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Bunlar kitabından çıkan ham sayfa kesitleri — AI özeti değil. Böylece
        içerik kaybı korkusu azalır; her sayfa burada durur.
      </p>
      {highlight.length > 0 && (
        <button
          type="button"
          onClick={onClearHighlight}
          className="text-xs text-slate-500 underline"
        >
          Seçim vurgusunu temizle
        </button>
      )}
      {sources.map((s) => (
        <article
          key={s.page}
          className={`rounded-xl border px-4 py-3 ${
            highlightPages.has(s.page)
              ? 'border-amber-300 bg-amber-50'
              : 'border-slate-200 bg-slate-50'
          }`}
        >
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Sayfa {s.page}
            </h3>
            {s.topics?.length > 0 && (
              <p className="text-xs text-slate-500">{s.topics.join(' · ')}</p>
            )}
          </header>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
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
    return <p className="text-slate-500">Henüz örnek yok.</p>
  }

  return (
    <ol className="space-y-6">
      {examples.map((ex, i) => (
        <li key={i} className="space-y-2">
          <p className="font-medium text-slate-900">
            Örnek {i + 1}: {ex.problem}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
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
    return <p className="text-slate-500">Henüz quiz yok.</p>
  }

  return (
    <div className="space-y-6">
      {quiz.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="font-medium text-slate-900">
            {i + 1}. {q.question}
          </p>
          <div className="space-y-1">
            {q.options.map((opt, oi) => {
              const selected = answers[i] === oi
              let cls = 'border-slate-200'
              if (submitted) {
                if (oi === q.correct_index) cls = 'border-emerald-500 bg-emerald-50'
                else if (selected) cls = 'border-red-400 bg-red-50'
              } else if (selected) cls = 'border-slate-900'
              return (
                <button
                  key={oi}
                  type="button"
                  disabled={submitted}
                  onClick={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                  className={`block w-full rounded-xl border px-3 py-2 text-left text-sm ${cls}`}
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {submitted && (
            <p className="text-xs text-slate-600">{q.explanation}</p>
          )}
        </div>
      ))}

      {!submitted ? (
        <button
          type="button"
          onClick={() => setSubmitted(true)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Kontrol et
        </button>
      ) : (
        <p className="font-medium text-slate-900">
          Skor: {score?.ok}/{score?.total}
        </p>
      )}
    </div>
  )
}
