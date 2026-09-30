import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { fetchMyLibrary, type LibraryItem } from '@/lib/library'

function sourceLabel(s: LibraryItem['source']) {
  if (s === 'mine') return 'Senin'
  if (s === 'shared') return 'Paylaşılan'
  return 'Grup'
}

export default function LibraryShelf() {
  const { user } = useAuth()
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

  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.source}-${item.bookId}`}>
          <Link to={item.href} className="library-row">
            <div className="min-w-0">
              <p className="font-display truncate text-[1.05rem] font-semibold">
                {item.title}
              </p>
              <p className="muted text-[11px]">
                {sourceLabel(item.source)}
                {item.subject ? ` · ${item.subject}` : ''}
              </p>
            </div>
            <span className="library-open shrink-0">Aç</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
