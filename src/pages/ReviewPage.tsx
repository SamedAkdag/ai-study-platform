import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import WorkspaceShell from '@/components/WorkspaceShell'
import { useAuth } from '@/lib/auth'
import { fetchMyLibrary } from '@/lib/library'
import { supabase } from '@/lib/supabase'
import {
  gradeLabel,
  listDueToday,
  pullAllSrsForUser,
  type SrsItem,
} from '@/lib/srs'

export default function ReviewPage() {
  const { user } = useAuth()
  const [srsTick, setSrsTick] = useState(0)

  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })
  const items = libQuery.data ?? []
  const titleById = useMemo(() => {
    const m = new Map<string, { title: string; href: string }>()
    for (const it of items) {
      m.set(it.bookId, { title: it.title, href: it.href })
    }
    return m
  }, [items])

  useEffect(() => {
    let cancelled = false
    void pullAllSrsForUser().then(() => {
      if (!cancelled) setSrsTick((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const due = useMemo(
    () => listDueToday(),
    [items, libQuery.dataUpdatedAt, srsTick],
  )

  const chapterIds = useMemo(
    () => [...new Set(due.map((d) => d.chapterId))],
    [due],
  )

  const chaptersQuery = useQuery({
    queryKey: ['review-chapter-titles', chapterIds.join(',')],
    queryFn: async () => {
      if (!chapterIds.length) return [] as { id: string; title: string }[]
      const { data, error } = await supabase
        .from('chapters')
        .select('id, title')
        .in('id', chapterIds)
      if (error) throw error
      return (data ?? []) as { id: string; title: string }[]
    },
    enabled: chapterIds.length > 0,
  })

  const chapterTitleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const row of chaptersQuery.data ?? []) {
      m.set(row.id, row.title)
    }
    return m
  }, [chaptersQuery.data])

  const grouped = useMemo(() => {
    const map = new Map<string, SrsItem[]>()
    for (const d of due) {
      const list = map.get(d.bookId) ?? []
      list.push(d)
      map.set(d.bookId, list)
    }
    return [...map.entries()].map(([bookId, list]) => ({
      bookId,
      meta: titleById.get(bookId),
      items: list,
    }))
  }, [due, titleById])

  return (
    <WorkspaceShell crumb="Tekrar planı">
      <div className="ws-home">
        <header className="ws-hero">
          <div>
            <h1 className="ws-hero__title">Tekrar</h1>
            <p className="ws-hero__sub">
              Bugün çalışılacak üniteler. Quiz bitince buraya düşer.
            </p>
          </div>
        </header>

        {libQuery.isLoading ? (
          <p className="muted text-sm">Yükleniyor…</p>
        ) : !due.length ? (
          <div className="ws-card ws-empty">
            <p className="font-display text-base font-semibold">Sıra boş</p>
            <p>
              Ünite quiz’lerini bitirdikçe buraya tekrarlar düşer.{' '}
              <Link to="/" className="underline">
                Çalışmaya başla
              </Link>
            </p>
          </div>
        ) : (
          <>
            <p className="muted text-sm" style={{ margin: 0 }}>
              {due.length} madde bugün veya daha önce için bekliyor.
            </p>
            {grouped.map((g) => (
              <section key={g.bookId}>
                <div className="ws-section-head">
                  <h2>
                    {g.meta?.title ?? 'Kitap'}
                    <span>· {g.items.length}</span>
                  </h2>
                  {g.meta ? (
                    <Link to={g.meta.href} className="muted text-xs font-semibold">
                      PDF →
                    </Link>
                  ) : null}
                </div>
                <div
                  className="ws-card"
                  style={{ paddingTop: '0.35rem', paddingBottom: '0.35rem' }}
                >
                  <ul className="ws-list">
                    {g.items.map((item) => {
                      const href = `/books/${item.bookId}/chapters/${item.chapterId}`
                      const chapterTitle =
                        chapterTitleById.get(item.chapterId) || 'Ünite tekrarı'
                      return (
                        <li
                          key={`${item.bookId}:${item.chapterId}:${item.itemKey}`}
                          className="ws-list__item"
                        >
                          <Link to={href} className="ws-list__link">
                            <p className="ws-list__kicker">
                              Vade {item.dueAt}
                              {item.lastGrade != null
                                ? ` · son: ${gradeLabel(item.lastGrade)}`
                                : ''}
                            </p>
                            <p className="ws-list__title">
                              {chapterTitle}
                              {item.itemKey !== 'chapter'
                                ? ` · ${item.itemKey}`
                                : ''}
                            </p>
                            <p className="ws-list__body">
                              Aralık {item.intervalDays} gün · tekrar{' '}
                              {item.repetitions}
                            </p>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </WorkspaceShell>
  )
}
