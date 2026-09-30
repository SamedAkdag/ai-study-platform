import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchContributions,
  quizTypeLabel,
  reviewContribution,
} from '@/lib/contributions'
import type { ChapterContribution, GroupMember, QuizItem } from '@/types/database'
import { roleAtLeast } from '@/lib/studyGroup'

type Props = {
  chapterId: string
  membership: GroupMember
  onApplied?: () => void
}

function summary(c: ChapterContribution) {
  const p = c.payload as Record<string, unknown>
  if (c.kind === 'quiz') {
    const q = p as Partial<QuizItem>
    return `${quizTypeLabel(q.type)}: ${String(q.question || '').slice(0, 80)}`
  }
  if (c.kind === 'example') {
    return `Örnek: ${String(p.problem || '').slice(0, 80)}`
  }
  return `Anlatım: ${String(p.title || p.markdown || '').slice(0, 80)}`
}

export default function ContributionReviewPanel({
  chapterId,
  membership,
  onApplied,
}: Props) {
  const queryClient = useQueryClient()
  const canReview = roleAtLeast(membership.role, 'admin')

  const pendingQuery = useQuery({
    queryKey: ['chapter-contributions', chapterId, 'pending'],
    queryFn: () => fetchContributions({ chapterId, status: 'pending' }),
    enabled: !!chapterId,
  })

  const mineQuery = useQuery({
    queryKey: ['chapter-contributions', chapterId, 'mine', membership.id],
    queryFn: async () => {
      const all = await fetchContributions({ chapterId })
      return all.filter((c) => c.member_id === membership.id).slice(0, 8)
    },
    enabled: !!chapterId && !canReview,
  })

  const review = useMutation({
    mutationFn: (input: {
      contributionId: string
      status: 'approved' | 'rejected'
    }) =>
      reviewContribution({
        contributionId: input.contributionId,
        reviewer: membership,
        status: input.status,
      }),
    onSuccess: async (contrib) => {
      await queryClient.invalidateQueries({
        queryKey: ['chapter-contributions', chapterId],
      })
      if (contrib.status === 'approved') onApplied?.()
    },
  })

  const pending = pendingQuery.data ?? []
  const mine = mineQuery.data ?? []

  if (canReview) {
    if (pendingQuery.isLoading) {
      return <p className="muted text-xs">Onay kuyruğu…</p>
    }
    if (!pending.length) return null

    return (
      <div className="surface-panel space-y-3 p-4 sm:p-5">
        <p className="text-sm font-semibold">
          Onay bekleyen katkılar ({pending.length})
        </p>
        <ul className="space-y-3">
          {pending.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border px-3 py-3 text-sm"
              style={{ borderColor: 'var(--line)' }}
            >
              <p className="font-semibold">{summary(c)}</p>
              <p className="muted mt-1 text-[11px]">
                {c.author_name} · {c.kind} ·{' '}
                {new Date(c.created_at).toLocaleString('tr-TR')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary !px-3 !py-1.5 text-xs"
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({
                      contributionId: c.id,
                      status: 'approved',
                    })
                  }
                >
                  Onayla
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({
                      contributionId: c.id,
                      status: 'rejected',
                    })
                  }
                >
                  Reddet
                </button>
              </div>
            </li>
          ))}
        </ul>
        {review.isError && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            {review.error instanceof Error
              ? review.error.message
              : 'İşlem başarısız'}
          </p>
        )}
      </div>
    )
  }

  if (!mine.length) return null

  return (
    <div className="surface-panel space-y-2 p-4">
      <p className="text-sm font-semibold">Senin katkıların</p>
      <ul className="space-y-1.5 text-xs">
        {mine.map((c) => (
          <li key={c.id} className="muted">
            {c.status === 'pending'
              ? '⏳'
              : c.status === 'approved'
                ? '✓'
                : '✗'}{' '}
            {summary(c)}
          </li>
        ))}
      </ul>
    </div>
  )
}
