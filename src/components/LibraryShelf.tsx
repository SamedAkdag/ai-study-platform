import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { deleteBookComplete } from '@/lib/bookPdf'
import {
  SUBJECT_OPTIONS,
  fetchMyLibrary,
  groupLibraryBySubject,
  hideLibraryBook,
  normalizeSubjectKey,
  subjectLabel,
  subjectToneClass,
  type LibraryItem,
  type SubjectValue,
} from '@/lib/library'
import {
  chapterProgressLabel,
  getBookProgress,
  summarizeBookProgress,
} from '@/lib/studyProgress'

type ShelfFilter = 'all' | 'shared' | SubjectValue

function sourceLabel(s: LibraryItem['source']) {
  if (s === 'mine') return 'Senin'
  if (s === 'shared') return 'Paylaşılan'
  return 'Grup'
}

function rowProgress(bookId: string) {
  const progressMap = getBookProgress(bookId)
  const labels = Object.values(progressMap)
    .map((p) => chapterProgressLabel(p))
    .filter(Boolean)
  const summary = summarizeBookProgress(bookId, Object.keys(progressMap))
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
  return { progressHint, pct }
}

function ShelfRow({
  item,
  busyId,
  onRemove,
}: {
  item: LibraryItem
  busyId: string | null
  onRemove: (item: LibraryItem) => void
}) {
  const { progressHint, pct } = rowProgress(item.bookId)
  const deleting = busyId === item.bookId

  return (
    <div className={`library-row ${subjectToneClass(item.subject)}`}>
      <span className="library-row__spine" aria-hidden />
      <Link to={item.href} className="library-row__body min-w-0 flex-1 no-underline">
        <p className="font-display truncate text-[1.05rem] font-semibold">
          {item.title}
        </p>
        <p className="muted text-[11px]">
          {sourceLabel(item.source)}
          {item.subject ? ` · ${subjectLabel(item.subject)}` : ''}
          {progressHint ? ` · ${progressHint}` : ''}
        </p>
        {pct > 0 ? (
          <span className="library-row__bar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </span>
        ) : null}
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="library-row__remove"
          disabled={deleting}
          title={
            item.source === 'mine'
              ? 'PDF’yi kalıcı sil'
              : 'Raftan kaldır'
          }
          onClick={() => onRemove(item)}
        >
          {deleting
            ? '…'
            : item.source === 'mine'
              ? 'Sil'
              : 'Kaldır'}
        </button>
        <Link to={item.href} className="library-open">
          Aç
        </Link>
      </div>
    </div>
  )
}

type Props = {
  /** Case-insensitive title filter from parent search. */
  searchQuery?: string
}

export default function LibraryShelf({ searchQuery = '' }: Props) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<ShelfFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })

  const items = libQuery.data ?? []
  const q = searchQuery.trim().toLocaleLowerCase('tr')

  const filtered = useMemo(() => {
    let list = items
    if (q) {
      list = list.filter(
        (i) =>
          i.title.toLocaleLowerCase('tr').includes(q) ||
          (i.subject || '').toLocaleLowerCase('tr').includes(q),
      )
    }
    if (filter === 'all') return list
    if (filter === 'shared') {
      return list.filter((i) => i.source === 'shared' || i.source === 'group')
    }
    return list.filter((i) => normalizeSubjectKey(i.subject) === filter)
  }, [items, filter, q])

  const groups = useMemo(() => groupLibraryBySubject(filtered), [filtered])

  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length, shared: 0 }
    for (const opt of SUBJECT_OPTIONS) counts[opt.value] = 0
    for (const item of items) {
      if (item.source === 'shared' || item.source === 'group') counts.shared += 1
      const key = normalizeSubjectKey(item.subject)
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, [items])

  async function removeItem(item: LibraryItem) {
    if (item.source === 'mine') {
      const ok = window.confirm(
        `"${item.title}" kalıcı olarak silinsin mi?\nPDF ve notlar geri alınamaz.`,
      )
      if (!ok) return
      setBusyId(item.bookId)
      try {
        await deleteBookComplete(item.bookId)
        void queryClient.invalidateQueries({ queryKey: ['my-library'] })
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Silinemedi. Tekrar dene.'
        window.alert(msg)
      } finally {
        setBusyId(null)
      }
      return
    }
    hideLibraryBook(item.bookId)
    void queryClient.invalidateQueries({ queryKey: ['my-library'] })
  }

  if (libQuery.isLoading) {
    return <p className="muted text-sm">Yükleniyor…</p>
  }

  if (!items.length) {
    return (
      <div className="library-empty">
        <p className="font-display text-base font-semibold">Raf boş</p>
        <p className="muted mt-1 text-sm leading-relaxed">
          Yukarıdan PDF yükle — ders seçerek rafta gruplanır.
        </p>
      </div>
    )
  }

  return (
    <div className="library-shelf-wrap">
      <div className="library-filters" role="tablist" aria-label="Derse göre filtre">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`library-filter${filter === 'all' ? ' is-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          Tümü
          <span className="library-filter__n">{subjectCounts.all}</span>
        </button>
        {SUBJECT_OPTIONS.map((opt) => {
          const n = subjectCounts[opt.value] ?? 0
          if (!n && filter !== opt.value) return null
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={filter === opt.value}
              className={`library-filter${filter === opt.value ? ' is-active' : ''}`}
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
              <span className="library-filter__n">{n}</span>
            </button>
          )
        })}
        {(subjectCounts.shared > 0 || filter === 'shared') && (
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'shared'}
            className={`library-filter${filter === 'shared' ? ' is-active' : ''}`}
            onClick={() => setFilter('shared')}
          >
            Paylaşılan
            <span className="library-filter__n">{subjectCounts.shared}</span>
          </button>
        )}
      </div>

      {!filtered.length ? (
        <div className="library-empty">
          <p className="muted text-sm">Bu filtrede kitap yok.</p>
        </div>
      ) : (
        <div className="library-groups">
          {groups.map((group) => (
            <section key={group.key} className="library-group">
              <header className="library-group__head">
                <h3 className="library-group__title">{group.label}</h3>
                <span className="library-group__count">{group.items.length}</span>
              </header>
              <ul className="library-shelf">
                {group.items.map((item, i) => (
                  <li
                    key={`${item.source}-${item.bookId}`}
                    className="library-shelf__item"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  >
                    <ShelfRow
                      item={item}
                      busyId={busyId}
                      onRemove={removeItem}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
