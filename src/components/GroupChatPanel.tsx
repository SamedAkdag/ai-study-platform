import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  canDeleteGroupMessage,
  deleteGroupMessage,
  fetchGroupMessages,
  formatMessageTime,
  postGroupMessage,
  shortRole,
} from '@/lib/groupChat'
import type { GroupMember } from '@/types/database'

type Props = {
  groupId: string
  chapterId?: string | null
  membership: GroupMember | null
  title?: string
}

export default function GroupChatPanel({
  groupId,
  chapterId = null,
  membership,
  title = 'Grup sohbeti',
}: Props) {
  const queryClient = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const queryKey = ['group-messages', groupId, chapterId ?? 'book']

  const messagesQuery = useQuery({
    queryKey,
    queryFn: () => fetchGroupMessages({ groupId, chapterId }),
    enabled: !!groupId && !!membership,
    refetchInterval: membership ? 8000 : false,
  })

  const postMutation = useMutation({
    mutationFn: () =>
      postGroupMessage({
        groupId,
        chapterId,
        member: membership!,
        body: draft,
      }),
    onSuccess: async () => {
      setDraft('')
      await queryClient.invalidateQueries({ queryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGroupMessage(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
    },
  })

  const messages = messagesQuery.data ?? []

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!membership || !draft.trim() || postMutation.isPending) return
    postMutation.mutate()
  }

  if (!membership) {
    return (
      <div className="surface-panel space-y-2 p-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="muted text-xs leading-relaxed">
          Grup sohbetini görmek ve yazmak için davet linkiyle gruba katılman
          gerekir.
        </p>
      </div>
    )
  }

  return (
    <div className="surface-panel flex flex-col p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="muted text-[11px]">
          {membership.display_name} · {shortRole(membership.role)}
        </p>
      </div>

      <div
        ref={listRef}
        className="mb-3 max-h-72 space-y-2.5 overflow-y-auto rounded-xl border p-3"
        style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.4)' }}
      >
        {messagesQuery.isLoading && (
          <p className="muted text-xs">Mesajlar yükleniyor…</p>
        )}
        {!messagesQuery.isLoading && messages.length === 0 && (
          <p className="muted text-xs">
            Henüz mesaj yok. Bu ünite hakkında soru veya yorum yaz.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="group text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold">{m.author_name}</span>
              <span className="muted text-[11px]">{shortRole(m.author_role)}</span>
              <span className="muted text-[11px]">
                {formatMessageTime(m.created_at)}
              </span>
              {canDeleteGroupMessage(membership, m) && (
                <button
                  type="button"
                  className="muted text-[11px] opacity-70 hover:opacity-100"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(m.id)}
                >
                  sil
                </button>
              )}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{m.body}</p>
          </div>
        ))}
        {messagesQuery.isError && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : 'Mesajlar yüklenemedi (migration?)'}
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Yorum veya soru yaz…"
          maxLength={2000}
          className="field !py-2 text-sm"
        />
        <button
          type="submit"
          className="btn-primary shrink-0 !px-3 !py-2 text-sm"
          disabled={postMutation.isPending || !draft.trim()}
        >
          Gönder
        </button>
      </form>
      {postMutation.isError && (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
          {postMutation.error instanceof Error
            ? postMutation.error.message
            : 'Gönderilemedi'}
        </p>
      )}
    </div>
  )
}
