import { Link, NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import AuthButton from '@/components/AuthButton'
import NotificationBell from '@/components/NotificationBell'
import ProductTour from '@/components/ProductTour'
import StudyTimerBadge from '@/components/StudyTimerBadge'
import ThemePicker from '@/components/ThemePicker'
import { useAuth } from '@/lib/auth'
import { fetchMyLibrary } from '@/lib/library'
import { formatWorkspaceDate } from '@/lib/workspaceHome'

type Props = {
  children: ReactNode
  crumb?: string
  autoTour?: boolean
}

const NAV = [
  { to: '/', label: 'Yükle', end: true, icon: 'upload' as const },
  { to: '/library', label: 'Kitaplığım', end: false, icon: 'library' as const },
  { to: '/tools', label: 'Araçlar', end: false, icon: 'tools' as const },
]

function NavIcon({ name }: { name: (typeof NAV)[number]['icon'] }) {
  if (name === 'upload') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 10.5V3M8 3 5.5 5.5M8 3l2.5 2.5M3 12.5h10"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (name === 'library') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3 2.5h4.5v11H3.8A.8.8 0 0 1 3 12.7V2.5Zm5.5 0H13v10.2a.8.8 0 0 1-.8.8H8.5V2.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export default function WorkspaceShell({
  children,
  crumb = 'Yükle',
  autoTour = false,
}: Props) {
  const { user, profile } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [manualTour, setManualTour] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const date = useMemo(() => formatWorkspaceDate(), [])

  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })
  const libraryCount = (libQuery.data ?? []).length

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  useEffect(() => {
    setMobileNav(false)
  }, [location.pathname])

  return (
    <div className="workspace">
      <aside className={`workspace-side${mobileNav ? ' is-open' : ''}`}>
        <Link to="/" className="workspace-brand" aria-label="Studium ana sayfa">
          <span className="workspace-brand__mark" aria-hidden />
          <span className="workspace-brand__name">studium</span>
        </Link>

        <p className="workspace-side__label">Studium</p>
        <nav className="workspace-nav" aria-label="Ana menü">
          {NAV.map((item) => {
            const count = item.to === '/library' ? libraryCount : null
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `workspace-nav__link${isActive ? ' is-active' : ''}`
                }
              >
                <span className="workspace-nav__icon">
                  <NavIcon name={item.icon} />
                </span>
                <span className="workspace-nav__text">{item.label}</span>
                {count != null && count > 0 ? (
                  <span className="workspace-nav__count">{count}</span>
                ) : null}
              </NavLink>
            )
          })}
        </nav>
      </aside>

      {mobileNav ? (
        <button
          type="button"
          className="workspace-scrim"
          aria-label="Menüyü kapat"
          onClick={() => setMobileNav(false)}
        />
      ) : null}

      <div className="workspace-main">
        <header className="workspace-top">
          <div className="workspace-top__left">
            <button
              type="button"
              className="workspace-menu-btn"
              aria-label="Menü"
              onClick={() => setMobileNav((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
            <p className="workspace-crumb">
              <Link to="/">Studium</Link>
              <span aria-hidden> › </span>
              <span>{crumb}</span>
            </p>
          </div>
          <div className="workspace-top__right">
            <p className="workspace-date">
              {date.weekday}, {date.dayMonth}
            </p>
            <StudyTimerBadge />
            <ThemePicker />
            <NotificationBell />
            {user ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  {profile ? `@${profile.username}` : 'Hesap'}
                </button>
                {menuOpen ? (
                  <div className="surface-panel absolute right-0 z-50 mt-2 w-44 space-y-0.5 p-1.5">
                    <Link
                      to="/library"
                      className="block rounded-lg px-2.5 py-2 text-xs"
                      onClick={() => setMenuOpen(false)}
                    >
                      Kitaplığım
                    </Link>
                    <Link
                      to="/notes"
                      className="block rounded-lg px-2.5 py-2 text-xs"
                      onClick={() => setMenuOpen(false)}
                    >
                      Notlarım
                    </Link>
                    <Link
                      to="/review"
                      className="block rounded-lg px-2.5 py-2 text-xs"
                      onClick={() => setMenuOpen(false)}
                    >
                      Tekrar planı
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
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setManualTour(true)}
              >
                Tur
              </button>
            )}
            <AuthButton />
          </div>
        </header>

        <div className="workspace-body">{children}</div>
      </div>

      {manualTour ? (
        <ProductTour open onClose={() => setManualTour(false)} />
      ) : autoTour ? (
        <ProductTour auto />
      ) : null}
    </div>
  )
}
