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
      <p className="muted text-sm leading-relaxed">
        Henüz kitap yok. Yukarıdan PDF yükle — veya bir davet linki aç.
      </p>
    )
  }

  function removeItem(item: LibraryItem) {
    if (item.source === 'mine') return
    hideLibraryBook(item.bookId)
    void queryClient.invalidateQueries({ queryKey: ['my-library'] })
  }

  return (
    <ul>
      {items.map((item) => {
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

        return (
          <li key={`${item.source}-${item.bookId}`}>
            <div className="library-row">
              <Link to={item.href} className="min-w-0 flex-1 no-underline">
                <p className="font-display truncate text-[1.05rem] font-semibold">
                  {item.title}
                </p>
                <p className="muted text-[11px]">
                  {sourceLabel(item.source)}
                  {item.subject ? ` · ${item.subject}` : ''}
                  {progressHint ? ` · ${progressHint}` : ''}
                </p>
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
