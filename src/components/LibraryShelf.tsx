import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import {
  fetchMyLibrary,
  hideLibraryBook,
  type LibraryItem,
} from '@/lib/library'
import {
  chapterProgressLabel,
  getBookProgress,
  summarizeBookProgress,
} from '@/lib/studyProgress'

function sourceLabel(s: LibraryItem['source']) {
  if (s === 'mine') return 'Senin'
  if (s === 'shared') return 'Paylaşılan'
  return 'Grup'
}

function subjectTone(subject?: string | null) {
  const s = (subject || '').toLowerCase()
  if (s.includes('math') || s.includes('matematik')) return 'tone-math'
  if (s.includes('phys') || s.includes('fizik')) return 'tone-phys'
  if (s.includes('hist') || s.includes('tarih')) return 'tone-hist'
  if (s.includes('law') || s.includes('hukuk') || s.includes('maliye'))
    return 'tone-law'
  return 'tone-default'
}

export default function LibraryShelf() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })

  const items = libQuery.data ?? []

  if (libQuery.isLoading) {
    return <p className="muted text-sm">Yükleniyor…</p>
  }

  if (!items.length) {
    return (
      <div className="library-empty">
        <p className="font-display text-base font-semibold">Raf boş</p>
        <p className="muted mt-1 text-sm leading-relaxed">
          Yukarıdan PDF yükle — veya bir davet linki aç.
        </p>
      </div>
    )
  }

  function removeItem(item: LibraryItem) {
    if (item.source === 'mine') return
    hideLibraryBook(item.bookId)
    void queryClient.invalidateQueries({ queryKey: ['my-library'] })
  }

  return (
    <ul className="library-shelf">
      {items.map((item, i) => {
        const progressMap = getBookProgress(item.bookId)
        const labels = Object.values(progressMap)
          .map((p) => chapterProgressLabel(p))
          .filter(Boolean)
        const summary = summarizeBookProgress(
          item.bookId,
          Object.keys(progressMap),
        )
        const progressHint =
          summary.opened > 0
            ? `${summary.opened} ünite açıldı${
                summary.quizzed ? ` · ${summary.quizzed} quiz` : ''
              }`
            : labels[0] || null
        const pct =
          summary.opened > 0 && Object.keys(progressMap).length
            ? Math.min(
                100,
                Math.round(
                  (summary.opened / Math.max(Object.keys(progressMap).length, 1)) *
                    100,
                ),
              )
            : 0

        return (
          <li
            key={`${item.source}-${item.bookId}`}
            className="library-shelf__item"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <div className={`library-row ${subjectTone(item.subject)}`}>
              <span className="library-row__spine" aria-hidden />
              <Link to={item.href} className="library-row__body min-w-0 flex-1 no-underline">
                <p className="font-display truncate text-[1.05rem] font-semibold">
                  {item.title}
                </p>
                <p className="muted text-[11px]">
                  {sourceLabel(item.source)}
                  {item.subject ? ` · ${item.subject}` : ''}
                  {progressHint ? ` · ${progressHint}` : ''}
                </p>
                {pct > 0 ? (
                  <span className="library-row__bar" aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                ) : null}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {item.source !== 'mine' && (
                  <button
                    type="button"
                    className="muted text-[11px] hover:opacity-80"
                    title="Raftan kaldır"
                    onClick={() => removeItem(item)}
                  >
                    Kaldır
                  </button>
                )}
                <Link to={item.href} className="library-open">
                  Aç
                </Link>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
