import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBook, fetchChapters } from '@/lib/api'
import AppShell from '@/components/AppShell'
import CoachBanner from '@/components/CoachBanner'
import UnitScopeDialog from '@/components/UnitScopeDialog'
import { processBookPipeline } from '@/lib/processBook'
import { stashUnitScope, type UnitScope } from '@/lib/unitScope'
import { friendlyAiError } from '@/lib/errors'

type DeskAction =
  | 'summary'
  | 'mindmap'
  | 'flash'
  | 'quiz'
  | 'pdf'

const CARDS: Array<{
  id: DeskAction
  icon: string
  title: string
  blurb: string
}> = [
  { id: 'summary', icon: '📝', title: 'Özeti Gör', blurb: 'Kısa anlatım' },
  { id: 'mindmap', icon: '🧠', title: 'Zihin Haritası', blurb: 'Konu dalları' },
  { id: 'flash', icon: '🃏', title: 'Kartlarla Çalış', blurb: 'Flash kartlar' },
  { id: 'quiz', icon: '❓', title: 'Test Çöz', blurb: 'Quiz' },
  { id: 'pdf', icon: '📖', title: 'PDF Üzerinde Çalış', blurb: 'Seç → AI' },
]

/**
 * Post-upload study desk — five equal cards, one next step if no units.
 */
export default function StudyDeskPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scopeOpen, setScopeOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<DeskAction | null>(null)
  const [pickUnit, setPickUnit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => fetchBook(bookId!),
    enabled: !!bookId,
  })
  const chaptersQuery = useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => fetchChapters(bookId!),
    enabled: !!bookId,
  })

  const chapters = chaptersQuery.data ?? []
  const hasUnits = chapters.length > 0
  const readyChapter =
    chapters.find((c) => c.status === 'ready') || chapters[0] || null

  const unitsMutation = useMutation({
    mutationFn: async (scope: UnitScope) => {
      if (!bookId || !bookQuery.data) throw new Error('Kitap yok')
      stashUnitScope(bookId, scope)
      await processBookPipeline({
        bookId,
        bookTitle: bookQuery.data.title,
        scope,
      })
    },
    onSuccess: async () => {
      setScopeOpen(false)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
      await queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      if (pendingAction && pendingAction !== 'pdf') {
        setPickUnit(true)
      }
    },
    onError: (err) => setError(friendlyAiError(err)),
  })

  const title = bookQuery.data?.title || 'Kaynak'
  const maxPage = bookQuery.data?.total_pages || 1

  const chapterHref = useMemo(() => {
    if (!bookId || !readyChapter) return null
    return (action: DeskAction) => {
      const base = `/books/${bookId}/chapters/${readyChapter.id}`
      if (action === 'summary') return base
      if (action === 'mindmap') return `${base}?studio=map`
      if (action === 'flash') return `${base}?mode=practice&panel=flash`
      if (action === 'quiz') return `${base}?mode=practice&panel=quiz`
      return `/books/${bookId}/read`
    }
  }, [bookId, readyChapter])

  function goCard(action: DeskAction) {
    setError(null)
    if (action === 'pdf') {
      navigate(`/books/${bookId}/read`)
      return
    }
    if (!hasUnits) {
      setPendingAction(action)
      setScopeOpen(true)
      return
    }
    if (chapters.length > 1) {
      setPendingAction(action)
      setPickUnit(true)
      return
    }
    const href = chapterHref?.(action)
    if (href) navigate(href)
  }

  function openChapter(chapterId: string, action: DeskAction) {
    if (!bookId) return
    if (action === 'pdf') {
      navigate(`/books/${bookId}/read`)
      return
    }
    let href = `/books/${bookId}/chapters/${chapterId}`
    if (action === 'mindmap') href += '?studio=map'
    if (action === 'flash') href += '?mode=practice&panel=flash'
    if (action === 'quiz') href += '?mode=practice&panel=quiz'
    navigate(href)
  }

  const isProcessing =
    bookQuery.data?.status === 'processing' || unitsMutation.isPending

  return (
    <AppShell wide bookId={bookId} showBookTimer>
      <div className="study-desk">
        <header className="study-desk__head">
          <p className="study-desk__eyebrow">{title}</p>
          <h1 className="study-desk__title">Notların hazır! Ne yapmak istersin?</h1>
        </header>

        <CoachBanner tipId="study-desk" />
        {!hasUnits ? <CoachBanner tipId="need-units" /> : null}

        {!hasUnits ? (
          <div className="study-desk__next">
            <button
              type="button"
              className="btn-primary"
              disabled={isProcessing}
              onClick={() => {
                setPendingAction(null)
                setScopeOpen(true)
              }}
            >
              {isProcessing ? 'Üniteler oluşuyor…' : 'Üniteleri oluştur'}
            </button>
            <Link to={`/books/${bookId}/read`} className="btn-ghost text-sm">
              Önce PDF’de gez →
            </Link>
          </div>
        ) : null}

        {error ? (
          <p className="alert-error mb-4 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="study-desk__grid">
          {CARDS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="study-desk__card"
              disabled={isProcessing && c.id !== 'pdf'}
              onClick={() => goCard(c.id)}
            >
              <span className="study-desk__card-icon" aria-hidden>
                {c.icon}
              </span>
              <span className="study-desk__card-title">{c.title}</span>
              <span className="study-desk__card-blurb">{c.blurb}</span>
            </button>
          ))}
        </div>

        {pickUnit && pendingAction && pendingAction !== 'pdf' ? (
          <div className="study-desk__pick" role="dialog" aria-label="Ünite seç">
            <p className="study-desk__pick-title">Hangi ünite?</p>
            <ul className="study-desk__pick-list">
              {chapters.map((ch) => (
                <li key={ch.id}>
                  <button
                    type="button"
                    className="study-desk__pick-item"
                    onClick={() => openChapter(ch.id, pendingAction)}
                  >
                    {ch.title}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setPickUnit(false)
                setPendingAction(null)
              }}
            >
              Vazgeç
            </button>
          </div>
        ) : null}
      </div>

      <UnitScopeDialog
        open={scopeOpen}
        maxPage={maxPage}
        hasUnits={hasUnits}
        busy={isProcessing}
        onClose={() => {
          setScopeOpen(false)
          setPendingAction(null)
        }}
        onConfirm={(scope) => {
          navigate(`/processing/${bookId}?next=study`)
          unitsMutation.mutate(scope)
        }}
      />
    </AppShell>
  )
}
