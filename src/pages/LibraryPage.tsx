import { useState } from 'react'
import { Link } from 'react-router-dom'
import WorkspaceShell from '@/components/WorkspaceShell'
import LibraryShelf from '@/components/LibraryShelf'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { fetchMyLibrary } from '@/lib/library'

/** Kitaplığım — click a source → PDF reader. */
export default function LibraryPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })
  const empty = !libQuery.isLoading && (libQuery.data?.length ?? 0) === 0

  return (
    <WorkspaceShell crumb="Kitaplığım">
      <div className="library-page">
        <header className="library-page__head">
          <h1 className="library-page__title">Kitaplığım</h1>
          {!empty ? (
            <label className="ws-search">
              <span aria-hidden>⌕</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ara"
                aria-label="Kitaplıkta ara"
              />
            </label>
          ) : null}
        </header>

        {empty ? (
          <div className="library-page__empty">
            <p className="library-page__empty-title">İlk çalışmanı başlat</p>
            <Link to="/" className="btn-primary">
              PDF veya konu
            </Link>
          </div>
        ) : (
          <LibraryShelf searchQuery={search} />
        )}
      </div>
    </WorkspaceShell>
  )
}
