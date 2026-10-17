import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clearGroupFocus,
  fetchGroupQuizBoard,
  focusFromGroup,
  setGroupFocus,
} from '@/lib/groupStudyPack'
import { roleAtLeast } from '@/lib/studyGroup'
import type { GroupMember, StudyGroup } from '@/types/database'
import { asError } from '@/lib/errors'
import { useState } from 'react'

type ChapterOpt = { id: string; title: string }

type Props = {
  group: StudyGroup
  membership: GroupMember | null
  chapters: ChapterOpt[]
  /** Path builder for chapter links */
  chapterHref: (chapterId: string) => string
}

/** Shared “today’s unit” + member quiz board for a study group. */
export default function GroupStudyPack({
  group,
  membership,
  chapters,
  chapterHref,
}: Props) {
  const queryClient = useQueryClient()
  const focus = focusFromGroup(group)
  const focusChapter = chapters.find((c) => c.id === focus.chapterId)
  const canSet = roleAtLeast(membership?.role, 'write')
  const [pickId, setPickId] = useState(focus.chapterId || chapters[0]?.id || '')
  const [note, setNote] = useState(focus.note || '')
  const [err, setErr] = useState<string | null>(null)

  const boardQuery = useQuery({
    queryKey: ['group-quiz-board', group.id, focus.chapterId],
    queryFn: () => fetchGroupQuizBoard(group.id, focus.chapterId!),
    enabled: !!focus.chapterId,
  })

  const setMutation = useMutation({
    mutationFn: () =>
      setGroupFocus({
        groupId: group.id,
        chapterId: pickId,
        note,
        setBy: membership?.display_name || 'Üye',
      }),
    onSuccess: async () => {
      setErr(null)
      await queryClient.invalidateQueries({
        queryKey: ['study-group-by-book', group.book_id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['group-quiz-board', group.id],
      })
    },
    onError: (e) => setErr(asError(e).message),
  })

  const clearMutation = useMutation({
    mutationFn: () => clearGroupFocus(group.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['study-group-by-book', group.book_id],
      })
    },
    onError: (e) => setErr(asError(e).message),
  })

  return (
    <section className="group-pack surface-panel p-4 sm:p-5" aria-label="Grup paketi">
      <p className="section-label mb-1">Grup çalışma paketi</p>
      <p className="font-display text-lg font-semibold tracking-tight">
        Bugünkü ünite
      </p>

      {focusChapter ? (
        <div className="mt-3 space-y-2">
          <Link
            to={chapterHref(focusChapter.id)}
            className="block font-semibold"
            style={{ color: 'var(--accent-deep)' }}
          >
            {focusChapter.title} →
          </Link>
          {focus.note ? (
            <p className="muted text-sm leading-relaxed">{focus.note}</p>
          ) : null}
          <p className="muted text-[11px]">
            {focus.setBy ? `${focus.setBy} belirledi` : 'Belirlendi'}
            {focus.updatedAt
              ? ` · ${new Date(focus.updatedAt).toLocaleString('tr-TR', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : ''}
          </p>
        </div>
      ) : (
        <p className="muted mt-2 text-sm">
          Henüz ortak ünite seçilmedi. Yazma yetkisi olan biri belirleyebilir.
        </p>
      )}

      {canSet && chapters.length > 0 ? (
        <div className="mt-4 space-y-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <label className="block text-xs">
            <span className="muted mb-1 block font-medium">Ünite seç</span>
            <select
              className="field text-sm"
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="muted mb-1 block font-medium">Not (opsiyonel)</span>
            <input
              className="field text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Örn. quiz’i bitirelim"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={!pickId || setMutation.isPending}
              onClick={() => setMutation.mutate()}
            >
              {setMutation.isPending ? 'Kaydediliyor…' : 'Bugünkü ünite yap'}
            </button>
            {focus.chapterId ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={clearMutation.isPending}
                onClick={() => clearMutation.mutate()}
              >
                Temizle
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {err ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger, #a33d3d)' }}>
          {err}
        </p>
      ) : null}

      {focus.chapterId ? (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <p className="section-label mb-2">Quiz panosu</p>
          {boardQuery.isLoading ? (
            <p className="muted text-xs">Yükleniyor…</p>
          ) : (
            <ul className="space-y-1.5">
              {(boardQuery.data ?? []).map((row) => (
                <li
                  key={row.memberId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="font-medium">{row.displayName}</span>
                  <span className="muted text-xs shrink-0">
                    {row.score != null && row.total != null
                      ? `${row.score}/${row.total}`
                      : row.userId
                        ? 'Henüz yok'
                        : 'Giriş yok'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted mt-2 text-[11px]">
            Skorlar giriş yapmış üyelerin quiz sonuçlarından gelir.
          </p>
        </div>
      ) : null}
    </section>
  )
}
