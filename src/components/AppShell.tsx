import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import StudyTimerBadge from '@/components/StudyTimerBadge'
import AuthButton from '@/components/AuthButton'
import NotificationBell from '@/components/NotificationBell'
import ProductTour from '@/components/ProductTour'
import { useAuth } from '@/lib/auth'

type Props = {
  children: ReactNode
  wide?: boolean
  bookId?: string | null
  showBookTimer?: boolean
  /** First-visit product tour only. */
  autoTour?: boolean
  /** Compact topbar + quiet footer (PDF study chrome). */
  studyChrome?: boolean
  /** Top-left study context (book › chapter), sits beside brand. */
  studyContext?: ReactNode
}

export default function AppShell({
  children,
  wide,
  bookId,
  showBookTimer,
  autoTour = false,
  studyChrome = false,
  studyContext,
}: Props) {
  const { user, profile } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [manualTour, setManualTour] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const shellClass = [
    'page-shell',
    wide ? 'max-w-none' : '',
    studyChrome ? 'page-shell--study-chrome' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={shellClass}
      style={
        wide
          ? { width: 'min(1680px, calc(100% - 1.25rem))' }
          : undefined
      }
    >
      <header className="app-topbar mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="app-topbar__lead">
          <Link to="/" className="brand-mark" aria-label="Studium ana sayfa">
            <span aria-hidden />
            Studium
          </Link>
          {studyContext ? (
            <div className="app-topbar__study">{studyContext}</div>
          ) : null}
        </div>
        <nav className="flex flex-wrap items-center gap-0.5">
          <StudyTimerBadge bookId={bookId} showBook={showBookTimer} />
          <NotificationBell />
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setMenuOpen((v) => !v)}
              >
                {profile ? `@${profile.username}` : 'Hesap'}
              </button>
              {menuOpen && (
                <div className="surface-panel absolute right-0 z-50 mt-2 w-44 space-y-0.5 p-1.5">
                  <Link
                    to="/"
                    className="block rounded-lg px-2.5 py-2 text-xs"
                    onClick={() => setMenuOpen(false)}
                  >
                    Kitaplık
                  </Link>
                  <Link
                    to="/stats"
                    className="block rounded-lg px-2.5 py-2 text-xs"
                    onClick={() => setMenuOpen(false)}
                  >
                    Süreler
                  </Link>
                  <Link
                    to="/social"
                    className="block rounded-lg px-2.5 py-2 text-xs"
                    onClick={() => setMenuOpen(false)}
                  >
                    Arkadaşlar
                  </Link>
                  <button
                    type="button"
                    className="block w-full rounded-lg px-2.5 py-2 text-left text-xs"
                    onClick={() => {
                      setMenuOpen(false)
                      setManualTour(true)
                    }}
                  >
                    Studium turu
                  </button>
                </div>
              )}
            </div>
          )}
          {!user && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setManualTour(true)}
            >
              Tur
            </button>
          )}
          <AuthButton />
        </nav>
      </header>
      {children}

      <footer className="site-footer">
        <a
          className="site-footer__link"
          href="https://araplhn.org/4/8d8abdc6923efc09dfeb1a9ac6a4dcbe"
          target="_blank"
          rel="noopener noreferrer sponsored"
        >
          Partner bağlantısı
        </a>
      </footer>

      {manualTour ? (
        <ProductTour open onClose={() => setManualTour(false)} />
      ) : autoTour ? (
        <ProductTour auto />
      ) : null}
    </div>
  )
}
