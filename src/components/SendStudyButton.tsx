import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { listAcceptedFriends, sendStudyShare } from '@/lib/social'

type Props = {
  bookId: string
  bookTitle: string
  /** Owner can always send; recipients only when public. */
  allowPrivate?: boolean
  disabledReason?: string | null
}

export default function SendStudyButton({
  bookId,
  bookTitle,
  allowPrivate = false,
  disabledReason = null,
}: Props) {
  const { user, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const friendsQuery = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => listAcceptedFriends(user!.id),
    enabled: !!user && open,
  })

  const send = useMutation({
    mutationFn: () =>
      sendStudyShare({
        fromUserId: user!.id,
        toUserId: picked!,
        bookId,
        note: note || `“${bookTitle}” çalışmana bak`,
      }),
    onSuccess: () => {
      setStatus('Gönderildi ✓')
      setNote('')
      setPicked(null)
      window.setTimeout(() => setOpen(false), 900)
    },
    onError: (err) =>
      setStatus(err instanceof Error ? err.message : 'Gönderilemedi'),
  })

  if (!user || !profile) {
    return (
      <p className="muted text-xs">
        Arkadaşa göndermek için giriş + @username gerekir.
      </p>
    )
  }

  if (disabledReason && !allowPrivate) {
    return <p className="muted text-xs">{disabledReason}</p>
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => {
          setOpen((v) => !v)
          setStatus(null)
        }}
      >
        {open ? 'Kapat' : 'Arkadaşa gönder'}
      </button>
      {open && (
        <div
          className="space-y-2 rounded-xl border p-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <p className="muted text-[11px]">
            {allowPrivate
              ? 'Private olsa da sahip olarak doğrudan gönderebilirsin. Public açınca alıcı da iletebilir.'
              : 'Kabul edilmiş arkadaşlarından birine doğrudan gönder.'}
          </p>
          <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
            {(friendsQuery.data ?? []).map((f) => (
              <li key={f.user_id}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs ${
                    picked === f.user_id ? 'font-semibold' : ''
                  }`}
                  style={
                    picked === f.user_id
                      ? { background: 'var(--accent-soft)' }
                      : undefined
                  }
                  onClick={() => setPicked(f.user_id)}
                >
                  @{f.username} · {f.display_name}
                </button>
              </li>
            ))}
            {!friendsQuery.isLoading &&
              (friendsQuery.data ?? []).length === 0 && (
                <li className="muted text-xs">
                  Önce /social üzerinden arkadaş ekle.
                </li>
              )}
          </ul>
          <input
            className="field !py-1.5 text-xs"
            placeholder="Kısa not (opsiyonel)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
          />
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={!picked || send.isPending}
            onClick={() => send.mutate()}
          >
            Gönder
          </button>
          {status && <p className="muted text-[11px]">{status}</p>}
        </div>
      )}
    </div>
  )
}
