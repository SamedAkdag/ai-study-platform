import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import AppShell from '@/components/AppShell'
import { getStoredDisplayName } from '@/lib/memberIdentity'
import { asError } from '@/lib/errors'
import { acceptGroupInvite, fetchInvitePreview, roleLabel } from '@/lib/studyGroup'

export default function JoinInvitePage() {
  const { inviteToken } = useParams<{ inviteToken: string }>()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState(getStoredDisplayName())

  const previewQuery = useQuery({
    queryKey: ['invite-preview', inviteToken],
    queryFn: () => fetchInvitePreview(inviteToken!),
    enabled: !!inviteToken,
    retry: false,
  })

  const joinMutation = useMutation({
    mutationFn: () =>
      acceptGroupInvite({ token: inviteToken!, displayName }),
    onSuccess: (result) => {
      const share = result.book.share_token
      if (result.book.is_public && share) {
        navigate(`/s/${share}`, { replace: true })
        return
      }
      navigate(`/books/${result.book.id}`, { replace: true })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    joinMutation.mutate()
  }

  if (previewQuery.isLoading) {
    return (
      <AppShell>
        <p className="muted">Davet kontrol ediliyor…</p>
      </AppShell>
    )
  }

  if (previewQuery.isError || !previewQuery.data) {
    return (
      <AppShell>
        <div className="surface-panel mx-auto max-w-lg p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">Davet geçersiz</h1>
          <p className="muted mt-2 text-sm">
            {previewQuery.error instanceof Error
              ? previewQuery.error.message
              : 'Bu davet bulunamadı veya iptal edilmiş.'}
          </p>
          <Link to="/" className="btn-primary mt-6 inline-flex">
            Studium’a git
          </Link>
        </div>
      </AppShell>
    )
  }

  const { invite, book } = previewQuery.data

  return (
    <AppShell>
      <div className="surface-panel mx-auto max-w-lg space-y-5 p-8">
        <div>
          <p
            className="text-xs font-semibold tracking-[0.18em] uppercase"
            style={{ color: 'var(--accent)' }}
          >
            Grup daveti
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight">
            {book.title}
          </h1>
          <p className="muted mt-2 text-sm leading-relaxed">
            Rol: <strong>{roleLabel(invite.role)}</strong>
            {invite.role === 'read' && ' — üniteleri oku, tartışmaya katıl.'}
            {invite.role === 'write' &&
              ' — içerik / quiz ekleyebilir, AI ile bölüm büyütebilirsin.'}
            {invite.role === 'admin' &&
              ' — üyeleri yönetir, içerik moderasyonu yapabilirsin.'}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm font-semibold">
            Görünen ad
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm"
              style={{ borderColor: 'var(--line)' }}
              placeholder="Örn. Ayşe"
              maxLength={48}
              required
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={joinMutation.isPending || !displayName.trim()}
          >
            {joinMutation.isPending ? 'Katılıyor…' : 'Gruba katıl'}
          </button>
          {joinMutation.isError && (
            <div className="alert-error text-sm">
              {asError(joinMutation.error, 'Katılım başarısız').message}
            </div>
          )}
        </form>
      </div>
    </AppShell>
  )
}
