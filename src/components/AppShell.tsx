import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  wide?: boolean
}

export default function AppShell({ children, wide }: Props) {
  return (
    <div className={`page-shell ${wide ? 'max-w-none' : ''}`} style={wide ? { width: 'min(1180px, calc(100% - 2rem))' } : undefined}>
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link to="/" className="brand-mark">
          <span aria-hidden />
          Studium
        </Link>
        <p className="muted hidden text-sm sm:block">Akademik AI çalışma platformu</p>
      </div>
      {children}
    </div>
  )
}
