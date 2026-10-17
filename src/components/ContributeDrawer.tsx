import ContributionComposer from '@/components/ContributionComposer'
import type { GroupMember } from '@/types/database'

type Props = {
  groupId: string
  chapterId: string
  chapterTitle: string
  membership: GroupMember
  contextExcerpt?: string
  onApplied?: () => void
}

/** Body for the right-edge “Ekle” panel (no page-bottom chrome). */
export default function ContributePanel({
  groupId,
  chapterId,
  chapterTitle,
  membership,
  contextExcerpt,
  onApplied,
}: Props) {
  return (
    <div className="contribute-panel">
      <p className="muted mb-3 text-[11px] leading-relaxed">
        Manuel veya AI taslak · gönderim Supabase’e yazılır
        {membership.role === 'write' || membership.role === 'read'
          ? ' · admin onayı gerekir'
          : ''}
      </p>
      <ContributionComposer
        variant="drawer"
        groupId={groupId}
        chapterId={chapterId}
        chapterTitle={chapterTitle}
        membership={membership}
        contextExcerpt={contextExcerpt}
        onApplied={onApplied}
      />
    </div>
  )
}
