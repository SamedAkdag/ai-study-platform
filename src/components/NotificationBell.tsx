import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { fetchNotifications } from '@/lib/notifications'

export default function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  const query = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => fetchNotifications(user!.id),
    enabled: !!user,
    refetchInterval: 45_000,
  })

  if (!user) return null

  const items = query.data ?? []
  const count = items.length

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost relative text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-label="Bildirimler"
      >
        Bildirim
        {count > 0 && (
          <span
            className="ml-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--accent-deep)' }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="surface-panel absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] p-2 shadow-lg">
          <p className="section-label px-2 py-1.5">Bildirimler</p>
          {query.isLoading && (
            <p className="muted px-2 py-3 text-xs">Yükleniyor…</p>
          )}
          {!query.isLoading && count === 0 && (
            <p className="muted px-2 py-3 text-xs">Yeni bildirim yok.</p>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  to={n.href}
                  className="block rounded-lg px-2.5 py-2 hover:bg-[var(--highlight)]"
                  onClick={() => setOpen(false)}
                >
                  <p className="text-xs font-semibold text-[var(--ink)]">
                    {n.title}
                  </p>
                  <p className="muted mt-0.5 text-[11px] leading-snug">
                    {n.body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
