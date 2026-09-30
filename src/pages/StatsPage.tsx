import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import AppShell from '@/components/AppShell'
import { useAuth } from '@/lib/auth'
import { computeStreak, fetchMyStudyFocus } from '@/lib/social'
import { formatStudyDuration } from '@/lib/studyTimer'
import { supabase } from '@/lib/supabase'

export default function StatsPage() {
  const { user, profile, loading } = useAuth()

  const focusQuery = useQuery({
    queryKey: ['study-focus', user?.id],
    queryFn: () => fetchMyStudyFocus(user!.id, 45),
    enabled: !!user,
  })

  const rows = focusQuery.data ?? []
  const bookIds = useMemo(
    () => [...new Set(rows.map((r) => r.book_id))],
    [rows],
  )
  const chapterIds = useMemo(
    () =>
      [...new Set(rows.map((r) => r.chapter_id).filter(Boolean))] as string[],
    [rows],
  )

  const booksQuery = useQuery({
    queryKey: ['stats-books', bookIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('books')
        .select('id, title')
        .in('id', bookIds)
      if (error) throw error
      return data ?? []
    },
    enabled: bookIds.length > 0,
  })

  const chaptersQuery = useQuery({
    queryKey: ['stats-chapters', chapterIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chapters')
        .select('id, title, book_id')
        .in('id', chapterIds)
      if (error) throw error
      return data ?? []
    },
    enabled: chapterIds.length > 0,
  })

  const bookMap = new Map((booksQuery.data ?? []).map((b) => [b.id, b.title]))
  const chapterMap = new Map(
    (chaptersQuery.data ?? []).map((c) => [c.id, c.title]),
  )

  const totalSeconds = rows.reduce((a, r) => a + r.seconds, 0)
  const today = new Date().toISOString().slice(0, 10)
  const todaySeconds = rows
    .filter((r) => r.day === today)
    .reduce((a, r) => a + r.seconds, 0)
  const streak = computeStreak(rows)

  const byBook = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.book_id, (map.get(r.book_id) ?? 0) + r.seconds)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const byChapter = useMemo(() => {
    const map = new Map<string, { bookId: string; seconds: number }>()
    for (const r of rows) {
      if (!r.chapter_id) continue
      const prev = map.get(r.chapter_id)
      map.set(r.chapter_id, {
        bookId: r.book_id,
        seconds: (prev?.seconds ?? 0) + r.seconds,
      })
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 12)
  }, [rows])

  const byDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.day, (map.get(r.day) ?? 0) + r.seconds)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
  }, [rows])

  if (loading) {
    return (
      <AppShell>
        <p className="muted">…</p>
      </AppShell>
    )
  }

  if (!user) {
    return (
      <AppShell>
        <div className="surface-panel mx-auto max-w-lg p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">İstatistikler</h1>
          <p className="muted mt-2 text-sm">
            Çalışma geçmişini görmek için giriş yap.
          </p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell wide>
      <header className="mb-8 space-y-2">
        <Link to="/social" className="btn-ghost">
          ← Sosyal
        </Link>
        <p
          className="text-xs font-semibold tracking-[0.18em] uppercase"
          style={{ color: 'var(--accent)' }}
        >
          Çalışma nabzı
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          {profile ? `@${profile.username}` : 'İstatistikler'}
        </h1>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="surface-panel p-4">
          <p className="muted text-[11px] uppercase tracking-wide">Bugün</p>
          <p className="font-display mt-1 text-2xl font-semibold">
            {formatStudyDuration(todaySeconds)}
          </p>
        </div>
        <div className="surface-panel p-4">
          <p className="muted text-[11px] uppercase tracking-wide">
            Son 45 gün
          </p>
          <p className="font-display mt-1 text-2xl font-semibold">
            {formatStudyDuration(totalSeconds)}
          </p>
        </div>
        <div className="surface-panel p-4">
          <p className="muted text-[11px] uppercase tracking-wide">Seri</p>
          <p className="font-display mt-1 text-2xl font-semibold">
            {streak} gün
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel space-y-3 p-5">
          <p className="text-sm font-semibold">Kitaplara göre</p>
          {byBook.length === 0 && (
            <p className="muted text-xs">Henüz kayıt yok — bir ünite açıp çalış.</p>
          )}
          <ul className="space-y-2 text-sm">
            {byBook.map(([id, sec]) => (
              <li key={id} className="flex justify-between gap-2">
                <span className="truncate">{bookMap.get(id) ?? id.slice(0, 8)}</span>
                <span className="muted shrink-0">{formatStudyDuration(sec)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-panel space-y-3 p-5">
          <p className="text-sm font-semibold">Ünitelere göre</p>
          <ul className="space-y-2 text-sm">
            {byChapter.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {chapterMap.get(c.id) ?? 'Ünite'}
                  <span className="muted">
                    {' '}
                    · {bookMap.get(c.bookId) ?? ''}
                  </span>
                </span>
                <span className="muted shrink-0">
                  {formatStudyDuration(c.seconds)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-panel space-y-3 p-5 lg:col-span-2">
          <p className="text-sm font-semibold">Günlük özet</p>
          <ul className="space-y-1.5 text-sm">
            {byDay.map(([day, sec]) => (
              <li key={day} className="flex justify-between gap-2">
                <span>{day}</span>
                <span className="muted">{formatStudyDuration(sec)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  )
}
