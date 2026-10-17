import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopicAccordion from '@/components/study/TopicAccordion'
import BlurredChat from '@/components/study/BlurredChat'
import GroupChatPanel from '@/components/GroupChatPanel'
import { splitStudyTopics } from '@/lib/splitStudyTopics'
import {
  loadTopicProgress,
  toggleTopicDone,
} from '@/lib/topicProgress'
import type { GroupMember } from '@/types/database'
import type { StudyTopicNav } from '@/components/study/StudyLeftNav'

type Props = {
  scopeId: string
  chapterTitle: string
  markdown: string
  groupId?: string | null
  membership?: GroupMember | null
  chapterId?: string | null
  /** Lift topic TOC into the left study nav. */
  onTopicNav?: (nav: StudyTopicNav | null) => void
}

/**
 * Retention reading: accordion topics; TOC lives in StudyLeftNav.
 */
export default function StudyTopicLayout({
  scopeId,
  chapterTitle,
  markdown,
  groupId,
  membership = null,
  chapterId = null,
  onTopicNav,
}: Props) {
  const topics = useMemo(
    () => splitStudyTopics(markdown, chapterTitle),
    [markdown, chapterTitle],
  )

  const [doneIds, setDoneIds] = useState<Set<string>>(() => {
    return new Set(loadTopicProgress(scopeId).done)
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    setDoneIds(new Set(loadTopicProgress(scopeId).done))
  }, [scopeId])

  useEffect(() => {
    if (topics[0] && !activeId) setActiveId(topics[0].id)
  }, [topics, activeId])

  const onToggleDone = useCallback(
    (id: string) => {
      const next = toggleTopicDone(scopeId, id)
      setDoneIds(new Set(next.done))
    },
    [scopeId],
  )

  const scrollToTopic = useCallback((id: string) => {
    setActiveId(id)
    const el = nodeRefs.current[id]
    if (!el) return
    window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 40)
  }, [])

  useEffect(() => {
    if (!onTopicNav) return
    if (topics.length === 0) {
      onTopicNav(null)
      return () => onTopicNav(null)
    }
    onTopicNav({
      topics,
      doneIds,
      activeId,
      onSelect: scrollToTopic,
      onToggleDone,
    })
    return () => onTopicNav(null)
  }, [
    onTopicNav,
    topics,
    doneIds,
    activeId,
    scrollToTopic,
    onToggleDone,
  ])

  if (topics.length === 0) {
    return (
      <p className="muted text-sm">Bu seviye için bölümlenecek içerik yok.</p>
    )
  }

  return (
    <div className="study-topic-layout">
      <div className="study-topic-main space-y-3">
        <p className="muted text-xs">
          Soldan konuya geç · tamamladıklarını işaretle
        </p>
        {topics.map((t, i) => (
          <TopicAccordion
            key={t.id}
            topic={t}
            index={i}
            done={doneIds.has(t.id)}
            onToggleDone={() => onToggleDone(t.id)}
            registerRef={(el) => {
              nodeRefs.current[t.id] = el
            }}
          />
        ))}

        <div className="pt-2">
          {groupId && membership ? (
            <GroupChatPanel
              groupId={groupId}
              chapterId={chapterId}
              membership={membership}
              title="Ünite sohbeti"
            />
          ) : (
            <BlurredChat title="Ünite sohbeti" chapterTitle={chapterTitle} />
          )}
        </div>
      </div>
    </div>
  )
}
