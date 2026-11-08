import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import WorkspaceShell from '@/components/WorkspaceShell'
import { useAuth } from '@/lib/auth'
import { fetchMyLibrary } from '@/lib/library'
import { fetchChapters } from '@/lib/api'
import { useEffect, useState } from 'react'

type ToolRow = {
  bookId: string
  bookTitle: string
  chapterId: string
  chapterTitle: string
  hasMap: boolean
  hasFlash: boolean
  hasQuiz: boolean
}

/** Araçlar — maps / cards / quizzes list; open result first. */
export default function ToolsPage() {
  const { user } = useAuth()
  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })
  const [rows, setRows] = useState<ToolRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const books = (libQuery.data ?? []).filter((b) => b.source === 'mine')
    if (!books.length) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const out: ToolRow[] = []
      for (const b of books.slice(0, 12)) {
        try {
          const chapters = await fetchChapters(b.bookId)
          for (const ch of chapters) {
            const hasMap = Boolean(ch.mind_map?.branches?.length)
            const hasFlash = Boolean(ch.flashcards?.length)
            const hasQuiz = Boolean(ch.quiz?.length)
            if (!hasMap && !hasFlash && !hasQuiz) continue
            out.push({
              bookId: b.bookId,
              bookTitle: b.title,
              chapterId: ch.id,
              chapterTitle: ch.title,
              hasMap,
              hasFlash,
              hasQuiz,
            })
          }
        } catch {
          /* skip */
        }
      }
      if (!cancelled) {
        setRows(out)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [libQuery.data])

  return (
    <WorkspaceShell crumb="Araçlar">
      <div className="tools-page">
        <h1 className="tools-page__title">Araçlar</h1>
        <p className="tools-page__lead">Hazır harita, kart ve testlerin</p>

        {loading ? (
          <p className="muted text-sm">Taraniyor…</p>
        ) : rows.length === 0 ? (
          <div className="tools-page__empty">
            <p>Henüz araç yok — bir kaynak yükleyip ünite oluştur.</p>
            <Link to="/" className="btn-primary">
              PDF’ini Yükle
            </Link>
          </div>
        ) : (
          <ul className="tools-page__list">
            {rows.map((r) => (
              <li key={r.chapterId} className="tools-page__row">
                <div>
                  <p className="tools-page__row-title">{r.chapterTitle}</p>
                  <p className="muted text-xs">{r.bookTitle}</p>
                </div>
                <div className="tools-page__links">
                  {r.hasMap ? (
                    <Link
                      to={`/books/${r.bookId}/chapters/${r.chapterId}?studio=map`}
                    >
                      Harita
                    </Link>
                  ) : null}
                  {r.hasFlash ? (
                    <Link
                      to={`/books/${r.bookId}/chapters/${r.chapterId}?mode=practice&panel=flash`}
                    >
                      Kartlar
                    </Link>
                  ) : null}
                  {r.hasQuiz ? (
                    <Link
                      to={`/books/${r.bookId}/chapters/${r.chapterId}?mode=practice&panel=quiz`}
                    >
                      Test
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WorkspaceShell>
  )
}
