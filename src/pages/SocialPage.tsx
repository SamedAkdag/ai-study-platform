import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppShell from '@/components/AppShell'
import { useAuth } from '@/lib/auth'
import {
  fetchFriendships,
  fetchInboxShares,
  fetchProfilesByIds,
  listAcceptedFriends,
  markShareRead,
  respondFriendRequest,
  searchProfiles,
  sendFriendRequest,
  upsertMyProfile,
} from '@/lib/social'
import { rememberLibraryBook } from '@/lib/library'
import { supabase } from '@/lib/supabase'

export default function SocialPage() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [usernameEdit, setUsernameEdit] = useState('')
  const [displayEdit, setDisplayEdit] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const friendshipsQuery = useQuery({
    queryKey: ['friendships', user?.id],
    queryFn: () => fetchFriendships(user!.id),
    enabled: !!user,
  })

  const friendsQuery = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => listAcceptedFriends(user!.id),
    enabled: !!user,
  })

  const inboxQuery = useQuery({
    queryKey: ['study-inbox', user?.id],
    queryFn: () => fetchInboxShares(user!.id),
    enabled: !!user,
  })

  const searchQuery = useQuery({
    queryKey: ['profile-search', q],
    queryFn: () => searchProfiles(q, user?.id),
    enabled: !!user && q.trim().length >= 2,
  })

  const pendingIncoming = useMemo(() => {
    const rows = friendshipsQuery.data ?? []
    if (!user) return []
    return rows.filter(
      (f) => f.status === 'pending' && f.addressee_id === user.id,
    )
  }, [friendshipsQuery.data, user])

  const pendingProfilesQuery = useQuery({
    queryKey: ['pending-profiles', pendingIncoming.map((p) => p.requester_id)],
    queryFn: () =>
      fetchProfilesByIds(pendingIncoming.map((p) => p.requester_id)),
    enabled: pendingIncoming.length > 0,
  })

  const bookIds = useMemo(
    () => [...new Set((inboxQuery.data ?? []).map((s) => s.book_id))],
    [inboxQuery.data],
  )

  const booksQuery = useQuery({
    queryKey: ['inbox-books', bookIds],
    queryFn: async () => {
      if (!bookIds.length) return [] as Array<{ id: string; title: string; share_token: string | null; is_public: boolean | null }>
      const { data, error } = await supabase
        .from('books')
        .select('id, title, share_token, is_public')
        .in('id', bookIds)
      if (error) throw error
      return data ?? []
    },
    enabled: bookIds.length > 0,
  })

  const fromIds = useMemo(
    () => [...new Set((inboxQuery.data ?? []).map((s) => s.from_user_id))],
    [inboxQuery.data],
  )
  const fromProfilesQuery = useQuery({
    queryKey: ['inbox-from', fromIds],
    queryFn: () => fetchProfilesByIds(fromIds),
    enabled: fromIds.length > 0,
  })

  const saveProfile = useMutation({
    mutationFn: () =>
      upsertMyProfile({
        userId: user!.id,
        username: usernameEdit || profile!.username,
        displayName: displayEdit || profile!.display_name,
      }),
    onSuccess: async () => {
      setMsg('Profil güncellendi')
      await refreshProfile()
    },
    onError: (err) =>
      setMsg(err instanceof Error ? err.message : 'Profil kaydedilemedi'),
  })

  const addFriend = useMutation({
    mutationFn: (toUserId: string) => sendFriendRequest(user!.id, toUserId),
    onSuccess: async () => {
      setMsg('İstek gönderildi')
      await queryClient.invalidateQueries({ queryKey: ['friendships'] })
      await queryClient.invalidateQueries({ queryKey: ['friends'] })
    },
    onError: (err) =>
      setMsg(err instanceof Error ? err.message : 'İstek başarısız'),
  })

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      respondFriendRequest(id, accept),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['friendships'] })
      await queryClient.invalidateQueries({ queryKey: ['friends'] })
    },
  })

  if (loading) {
    return (
      <AppShell>
        <p className="muted">…</p>
      </AppShell>
    )
  }

  if (!user) {
    return (
      <AppShell>
        <div className="surface-panel mx-auto max-w-lg p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">Sosyal</h1>
          <p className="muted mt-2 text-sm">
            Arkadaş eklemek ve çalışma göndermek için giriş yap.
          </p>
        </div>
      </AppShell>
    )
  }

  if (!profile) {
    return (
      <AppShell>
        <div className="surface-panel mx-auto max-w-lg space-y-3 p-6">
          <h1 className="font-display text-2xl font-semibold">
            Kullanıcı adını seç
          </h1>
          <p className="muted text-sm">
            Instagram gibi benzersiz @username — sonra arkadaş bulabilirsin.
          </p>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              saveProfile.mutate()
            }}
            className="space-y-2"
          >
            <input
              className="field text-sm"
              placeholder="@kullanici_adi"
              value={usernameEdit}
              onChange={(e) => setUsernameEdit(e.target.value)}
              required
            />
            <input
              className="field text-sm"
              placeholder="Görünen ad"
              value={displayEdit}
              onChange={(e) => setDisplayEdit(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={saveProfile.isPending}>
              Kaydet
            </button>
          </form>
          {msg && <p className="muted text-xs">{msg}</p>}
        </div>
      </AppShell>
    )
  }

  const bookMap = new Map((booksQuery.data ?? []).map((b) => [b.id, b]))
  const fromMap = new Map(
    (fromProfilesQuery.data ?? []).map((p) => [p.user_id, p]),
  )
  const pendingMap = new Map(
    (pendingProfilesQuery.data ?? []).map((p) => [p.user_id, p]),
  )

  return (
    <AppShell wide>
      <header className="mb-8 space-y-2">
        <p
          className="text-xs font-semibold tracking-[0.18em] uppercase"
          style={{ color: 'var(--accent)' }}
        >
          Sosyal
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          @{profile.username}
        </h1>
        <p className="muted text-sm">{profile.display_name}</p>
        <p className="muted mt-2 text-sm">
          Arkadaş ekle, gelen çalışmaları kitaplığına kaydet. Ana çalışma
          deneyimi ana sayfada (PDF + kitaplık).
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel space-y-3 p-5">
          <p className="text-sm font-semibold">Arkadaş bul</p>
          <input
            className="field text-sm"
            placeholder="@kullanici ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="space-y-2">
            {(searchQuery.data ?? []).map((p) => (
              <li
                key={p.user_id}
                className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--line)' }}
              >
                <span>
                  @{p.username}
                  <span className="muted"> · {p.display_name}</span>
                </span>
                <button
                  type="button"
                  className="btn-primary !px-2.5 !py-1 text-xs"
                  disabled={addFriend.isPending}
                  onClick={() => addFriend.mutate(p.user_id)}
                >
                  Ekle
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-panel space-y-3 p-5">
          <p className="text-sm font-semibold">
            Gelen istekler ({pendingIncoming.length})
          </p>
          {pendingIncoming.length === 0 && (
            <p className="muted text-xs">Bekleyen istek yok.</p>
          )}
          <ul className="space-y-2">
            {pendingIncoming.map((f) => {
              const p = pendingMap.get(f.requester_id)
              return (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span>@{p?.username ?? '…'}</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="btn-primary !px-2.5 !py-1 text-xs"
                      onClick={() =>
                        respond.mutate({ id: f.id, accept: true })
                      }
                    >
                      Kabul
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() =>
                        respond.mutate({ id: f.id, accept: false })
                      }
                    >
                      Red
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>

          <p className="pt-2 text-sm font-semibold">
            Arkadaşlar ({friendsQuery.data?.length ?? 0})
          </p>
          <ul className="space-y-1.5 text-sm">
            {(friendsQuery.data ?? []).map((p) => (
              <li key={p.user_id} className="muted">
                @{p.username} · {p.display_name}
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-panel space-y-3 p-5 lg:col-span-2">
          <p className="text-sm font-semibold">Gelen çalışmalar</p>
          {(inboxQuery.data ?? []).length === 0 && (
            <p className="muted text-xs">
              Arkadaşların sana kitap gönderince burada görünür.
            </p>
          )}
          <ul className="space-y-2">
            {(inboxQuery.data ?? []).map((s) => {
              const book = bookMap.get(s.book_id)
              const from = fromMap.get(s.from_user_id)
              const href =
                book?.is_public && book.share_token
                  ? `/s/${book.share_token}`
                  : `/books/${s.book_id}`
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-3 text-sm"
                  style={{
                    borderColor: 'var(--line)',
                    opacity: s.read_at ? 0.7 : 1,
                  }}
                >
                  <div>
                    <p className="font-semibold">
                      {book?.title ?? 'Çalışma'}
                    </p>
                    <p className="muted text-xs">
                      @{from?.username ?? '…'}
                      {s.note ? ` · “${s.note}”` : ''}
                    </p>
                  </div>
                  <Link
                    to={href}
                    className="btn-primary !px-3 !py-1.5 text-xs"
                    onClick={() => {
                      if (!s.read_at) void markShareRead(s.id)
                      if (book) {
                        rememberLibraryBook({
                          bookId: book.id,
                          title: book.title,
                          shareToken: book.share_token,
                          source: 'shared',
                        })
                      }
                    }}
                  >
                    Aç
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
      {msg && <p className="muted mt-4 text-xs">{msg}</p>}
    </AppShell>
  )
}
