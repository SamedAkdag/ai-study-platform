import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import WorkspaceShell from '@/components/WorkspaceShell'
import { useAuth } from '@/lib/auth'
import { fetchMyLibrary } from '@/lib/library'
import {
  annotationAiLabel,
  annotationKindLabel,
} from '@/lib/pdfAnnotations'
import { collectAllNotes } from '@/lib/workspaceHome'

export default function NotesPage() {
  const { user } = useAuth()
  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })
  const items = libQuery.data ?? []
  const notes = useMemo(() => collectAllNotes(items), [items])

  const byBook = useMemo(() => {
    const map = new Map<string, typeof notes>()
    for (const n of notes) {
      const list = map.get(n.bookId) ?? []
      list.push(n)
      map.set(n.bookId, list)
    }
    return [...map.entries()].map(([bookId, list]) => ({
      bookId,
      title: list[0]?.bookTitle ?? 'Kitap',
      href: list[0]?.href.split('?')[0] ?? `/books/${bookId}/read`,
      notes: list,
    }))
  }, [notes])

  return (
    <WorkspaceShell crumb="Notlarım">
      <div className="ws-home">
        <header className="ws-hero">
          <div>
            <h1 className="ws-hero__title">Notlar</h1>
            <p className="ws-hero__sub">
              Tüm kitaplardaki vurgular ve AI eklerin. Birine dokun, sayfaya dön.
            </p>
          </div>
        </header>

        {libQuery.isLoading ? (
          <p className="muted text-sm">Yükleniyor…</p>
        ) : !notes.length ? (
          <div className="ws-card ws-empty">
            <p className="font-display text-base font-semibold">Henüz not yok</p>
            <p>
              Bir PDF açıp metin seçerek not veya AI özeti ekle.{' '}
              <Link to="/" className="underline">
                Kitaplığa dön
              </Link>
            </p>
          </div>
        ) : (
          byBook.map((group) => (
            <section key={group.bookId}>
              <div className="ws-section-head">
                <h2>
                  {group.title}
                  <span>· {group.notes.length} kayıt</span>
                </h2>
                <Link to={group.href} className="muted text-xs font-semibold">
                  Kitabı aç →
                </Link>
              </div>
              <div className="ws-card" style={{ paddingTop: '0.35rem', paddingBottom: '0.35rem' }}>
                <ul className="ws-list">
                  {group.notes.map((n) => {
                    const a = n.annotation
                    const label =
                      a.kind === 'ai'
                        ? annotationAiLabel(a.aiMode)
                        : annotationKindLabel(a.kind)
                    const preview =
                      (a.body || a.quote || '').replace(/\s+/g, ' ').trim()
                    return (
                      <li key={a.id} className="ws-list__item">
                        <Link to={n.href} className="ws-list__link">
                          <p className="ws-list__kicker">
                            {label} · s.{a.page}
                          </p>
                          <p className="ws-list__title">
                            {a.quote
                              ? `“${a.quote.slice(0, 100)}${a.quote.length > 100 ? '…' : ''}”`
                              : label}
                          </p>
                          {preview && preview !== a.quote ? (
                            <p className="ws-list__body">{preview}</p>
                          ) : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          ))
        )}
      </div>
    </WorkspaceShell>
  )
}
