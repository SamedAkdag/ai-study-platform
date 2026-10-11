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
  /** First-visit product tour only (no manual entry point). */
  autoTour?: boolean
}

export default function AppShell({
  children,
  wide,
  bookId,
  showBookTimer,
  autoTour = false,
}: Props) {
  const { user, profile } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div
      className={`page-shell ${wide ? 'max-w-none' : ''}`}
      style={wide ? { width: 'min(1280px, calc(100% - 1rem))' } : undefined}
    >
      <header className="app-topbar mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="brand-mark">
          <span aria-hidden />
          Studium
        </Link>
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
                </div>
              )}
            </div>
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

      {autoTour ? <ProductTour auto /> : null}
    </div>
  )
}
