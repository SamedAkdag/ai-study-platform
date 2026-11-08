type Props = {
  status: 'writing' | 'ready' | 'error'
  error?: string | null
  onKeep: () => void
  onUndo: () => void
  onAsk: () => void
}

/** Edge chips after a page-tear AI moment — stay on the book, not a chat rail. */
export default function PageMomentChips({
  status,
  error,
  onKeep,
  onUndo,
  onAsk,
}: Props) {
  return (
    <div className="page-moment-chips" role="status" aria-live="polite">
      {status === 'writing' ? (
        <p className="page-moment-chips__status">Sayfa açılıyor — Studium yazıyor…</p>
      ) : null}
      {status === 'error' ? (
        <p className="page-moment-chips__status page-moment-chips__status--err">
          {error || 'Yazılamadı'}
        </p>
      ) : null}
      {status === 'ready' ? (
        <p className="page-moment-chips__status">Kitaba işlendi</p>
      ) : null}
      <div className="page-moment-chips__row">
        {status === 'ready' || status === 'error' ? (
          <button type="button" className="btn-primary text-xs" onClick={onKeep}>
            Tut
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={onUndo}
          disabled={status === 'writing'}
        >
          Geri al
        </button>
        {status === 'ready' ? (
          <button type="button" className="btn-ghost text-xs" onClick={onAsk}>
            Sor →
          </button>
        ) : null}
      </div>
    </div>
  )
}
