import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createGroupInvite,
  ensureStudyGroup,
  ensureOwnerMembership,
  fetchGroupInvites,
  fetchGroupMembers,
  fetchMyMembership,
  removeGroupMember,
  revokeGroupInvite,
  roleAtLeast,
  roleLabel,
  updateMemberRole,
} from '@/lib/studyGroup'
import type { GroupRole, InviteRole } from '@/types/database'

type Props = {
  bookId: string
  shareToken: string | null
}

const INVITE_ROLES: InviteRole[] = ['read', 'write', 'admin']

export default function GroupSharePanel({ bookId, shareToken }: Props) {
  const queryClient = useQueryClient()
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const groupQuery = useQuery({
    queryKey: ['study-group', bookId],
    queryFn: async () => {
      const group = await ensureStudyGroup(bookId)
      await ensureOwnerMembership(group.id)
      return group
    },
  })

  const groupId = groupQuery.data?.id

  const membersQuery = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => fetchGroupMembers(groupId!),
    enabled: !!groupId,
  })

  const invitesQuery = useQuery({
    queryKey: ['group-invites', groupId],
    queryFn: () => fetchGroupInvites(groupId!),
    enabled: !!groupId,
  })

  const meQuery = useQuery({
    queryKey: ['group-me', groupId],
    queryFn: () => fetchMyMembership(groupId!),
    enabled: !!groupId,
  })

  const canManage = roleAtLeast(meQuery.data?.role, 'admin')

  const createInvite = useMutation({
    mutationFn: (role: InviteRole) =>
      createGroupInvite({
        groupId: groupId!,
        role,
        label: `${roleLabel(role)} daveti`,
      }),
    onSuccess: async (invite) => {
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['group-invites', groupId] })
      await copyInvite(invite.token)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Davet oluşturulamadı')
    },
  })

  const revokeInvite = useMutation({
    mutationFn: (id: string) => revokeGroupInvite(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['group-invites', groupId] })
    },
  })

  const changeRole = useMutation({
    mutationFn: ({
      memberId,
      role,
    }: {
      memberId: string
      role: Exclude<GroupRole, 'owner'>
    }) => updateMemberRole(memberId, role),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] })
    },
  })

  const removeMember = useMutation({
    mutationFn: (id: string) => removeGroupMember(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] })
    },
  })

  async function copyInvite(token: string) {
    const url = `${window.location.origin}/join/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedInvite(token)
      window.setTimeout(() => setCopiedInvite(null), 2500)
    } catch {
      window.prompt('Davet linkini kopyala:', url)
    }
  }

  if (groupQuery.isLoading) {
    return <p className="muted text-xs">Grup yükleniyor…</p>
  }

  if (groupQuery.isError) {
    return (
      <div className="alert-error text-sm">
        Grup açılamadı. Migration çalıştırıldı mı? (
        {groupQuery.error instanceof Error
          ? groupQuery.error.message
          : 'bilinmeyen hata'}
        )
      </div>
    )
  }

  const members = membersQuery.data ?? []
  const invites = invitesQuery.data ?? []

  return (
    <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
      <div>
        <p className="text-sm font-semibold">Çalışma grubu</p>
        <p className="muted mt-1 text-xs leading-relaxed">
          Public link salt okuma. Yazma / admin için ayrı davet linki ver.
          {meQuery.data ? (
            <>
              {' '}
              Senin rolün: <strong>{roleLabel(meQuery.data.role)}</strong>
            </>
          ) : null}
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {INVITE_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              disabled={createInvite.isPending || !groupId}
              className="btn-ghost text-xs"
              onClick={() => createInvite.mutate(role)}
            >
              {copiedInvite && createInvite.data?.role === role
                ? 'Kopyalandı ✓'
                : `${roleLabel(role)} daveti`}
            </button>
          ))}
        </div>
      )}

      {invites.length > 0 && (
        <div className="space-y-2">
          <p className="muted text-[11px] font-semibold tracking-wide uppercase">
            Aktif davetler
          </p>
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--line)' }}
              >
                <span>
                  {roleLabel(inv.role)}
                  {inv.label ? ` · ${inv.label}` : ''}
                  {' · '}
                  {inv.use_count} katılım
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    className="btn-ghost text-[11px]"
                    onClick={() => void copyInvite(inv.token)}
                  >
                    {copiedInvite === inv.token ? '✓' : 'Kopyala'}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className="btn-ghost text-[11px]"
                      disabled={revokeInvite.isPending}
                      onClick={() => revokeInvite.mutate(inv.id)}
                    >
                      İptal
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <p className="muted text-[11px] font-semibold tracking-wide uppercase">
          Üyeler ({members.length})
        </p>
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--line)' }}
            >
              <span>
                {m.display_name}{' '}
                <span className="muted">· {roleLabel(m.role)}</span>
              </span>
              {canManage && m.role !== 'owner' && (
                <span className="flex flex-wrap items-center gap-1">
                  <select
                    className="rounded-lg border bg-transparent px-2 py-1 text-[11px]"
                    style={{ borderColor: 'var(--line)' }}
                    value={m.role}
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate({
                        memberId: m.id,
                        role: e.target.value as Exclude<GroupRole, 'owner'>,
                      })
                    }
                  >
                    <option value="read">Okuma</option>
                    <option value="write">Yazma</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="button"
                    className="btn-ghost text-[11px]"
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(m.id)}
                  >
                    Çıkar
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {shareToken && (
        <p className="muted break-all text-[11px]">
          Public okuma: {window.location.origin}/s/{shareToken}
        </p>
      )}
      {error && <div className="alert-error text-sm">{error}</div>}
    </div>
  )
}
