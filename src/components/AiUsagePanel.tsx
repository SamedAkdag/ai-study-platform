import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  aiUsageOperationLabel,
  fetchAiUsageEvents,
} from '@/lib/api'

type Props = {
  bookId: string
  chapterId?: string | null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 10_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return n.toLocaleString('tr-TR')
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function AiUsagePanel({ bookId, chapterId }: Props) {
  const [chapterOnly, setChapterOnly] = useState(false)

  const query = useQuery({
    queryKey: [
      'ai-usage',
      bookId,
      chapterOnly ? chapterId || 'chapter' : 'book',
    ],
    queryFn: () =>
      fetchAiUsageEvents({
        bookId,
        chapterId,
        chapterOnly: chapterOnly && !!chapterId,
        limit: 100,
      }),
    enabled: !!bookId,
    staleTime: 8_000,
    refetchOnMount: 'always',
  })

  const { events = [], totals } = query.data || {}
  const prompt = totals?.prompt_tokens ?? 0
  const completion = totals?.completion_tokens ?? 0
  const cached = totals?.cached_tokens ?? 0
  const miss = totals?.prompt_miss_tokens ?? Math.max(0, prompt - cached)
  const hitPct =
    prompt > 0 ? Math.min(100, Math.round((cached / prompt) * 100)) : 0

  return (
    <div className="ai-usage-panel space-y-3">
      <div>
        <p className="muted text-[11px] leading-snug">
          <strong className="font-semibold text-[var(--ink)]">Miss</strong> ≈
          ücretli input; Cache ≈ indirimli. Input Σ her çağrıda tam prompt’u
          toplar (büyüklüğü normal). İlk çağrı hep miss; sonrakilerde Cache
          %80–95 beklenir. %50 civarı = GÖREV hâlâ büyük veya önek kırık.
        </p>
      </div>

      {chapterId ? (
        <div className="ai-usage-panel__scope" role="tablist" aria-label="Kapsam">
          <button
            type="button"
            role="tab"
            aria-selected={!chapterOnly}
            className={!chapterOnly ? 'is-active' : undefined}
            onClick={() => setChapterOnly(false)}
          >
            Kitap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={chapterOnly}
            className={chapterOnly ? 'is-active' : undefined}
            onClick={() => setChapterOnly(true)}
          >
            Bu ünite
          </button>
        </div>
      ) : null}

      <div className="ai-usage-panel__totals ai-usage-panel__totals--4" aria-live="polite">
        <div>
          <span className="ai-usage-panel__label">Miss</span>
          <strong>{formatTokens(miss)}</strong>
        </div>
        <div>
          <span className="ai-usage-panel__label">Cache</span>
          <strong title={`Hit oranı %${hitPct}`}>
            {formatTokens(cached)}
            {prompt > 0 ? (
              <span className="ai-usage-panel__hit-pct">%{hitPct}</span>
            ) : null}
          </strong>
        </div>
        <div>
          <span className="ai-usage-panel__label">Output</span>
          <strong>{formatTokens(completion)}</strong>
        </div>
        <div>
          <span className="ai-usage-panel__label">Input Σ</span>
          <strong>{formatTokens(prompt)}</strong>
        </div>
      </div>

      {query.isLoading ? (
        <p className="muted text-[11px]">Yükleniyor…</p>
      ) : query.isError ? (
        <p className="text-[11px] text-red-700">
          {(query.error as Error)?.message || 'Kayıtlar okunamadı'}
          <span className="muted mt-1 block">
            `cached_tokens` kolonu yoksa migration’ı uygula.
          </span>
        </p>
      ) : events.length === 0 ? (
        <p className="muted text-[11px]">
          Henüz kayıt yok. <b>Toplu üret</b> ile not+özet+detay+alıştır+haritayı
          peş peşe çalıştır — cache hit’i burada görürsün.
        </p>
      ) : (
        <ul className="ai-usage-panel__list">
          {events.map((e) => {
            const c = e.cached_tokens || 0
            const m = Math.max(0, (e.prompt_tokens || 0) - c)
            return (
              <li key={e.id} className="ai-usage-panel__row">
                <div className="ai-usage-panel__row-main">
                <span className="ai-usage-panel__op">
                  {aiUsageOperationLabel(e.operation, e.meta)}
                </span>
                  <time
                    className="muted text-[10px]"
                    dateTime={e.created_at}
                  >
                    {formatWhen(e.created_at)}
                  </time>
                </div>
                <div className="ai-usage-panel__row-tokens">
                  <span title="Cache miss (yaklaşık ücretli input)">
                    miss {formatTokens(m)}
                  </span>
                  <span title="Cache hit">
                    cache {formatTokens(c)}
                    {c > 0 ? ' ✓' : ''}
                  </span>
                  <span title="Output">↑{formatTokens(e.completion_tokens)}</span>
                  <span className="ai-usage-panel__total-cell" title="Toplam">
                    {formatTokens(e.total_tokens)}
                    {e.estimated ? (
                      <abbr
                        title="API usage vermedi; yaklaşık hesap"
                        className="muted"
                      >
                        ~
                      </abbr>
                    ) : null}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        className="btn-ghost w-full text-[11px]"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? 'Yenileniyor…' : 'Yenile'}
      </button>
    </div>
  )
}
