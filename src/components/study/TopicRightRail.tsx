import { useState } from 'react'
import type { StudyTopic } from '@/lib/splitStudyTopics'

type Props = {
  topics: StudyTopic[]
  doneIds: Set<string>
  activeId: string | null
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
}

/**
 * Right-edge unit rail: thin peek → hover reveals soft title list (no numbers).
 */
export default function TopicRightRail({
  topics,
  doneIds,
  activeId,
  onSelect,
  onToggleDone,
}: Props) {
  const [pinned, setPinned] = useState(false)
  const done = topics.filter((t) => doneIds.has(t.id)).length
  const total = topics.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  if (total === 0) return null

  return (
    <aside
      className={`topic-rail ${pinned ? 'is-open' : ''}`}
      aria-label="Üniteler"
      onMouseLeave={() => {
        if (!pinned) return
      }}
    >
      <div className="topic-rail__hit" aria-hidden />
      <div className="topic-rail__sheet">
        <button
          type="button"
          className="topic-rail__peek"
          title="Üniteler"
          aria-expanded={pinned}
          onClick={() => setPinned((v) => !v)}
        >
          <span className="topic-rail__grip" aria-hidden />
          <span className="topic-rail__peek-label">Üniteler</span>
        </button>

        <div className="topic-rail__flyout">
          <div className="topic-rail__head">
            <div>
              <p className="topic-rail__heading">Üniteler</p>
              <p className="topic-rail__meta">
                {done} / {total} tamam
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost text-[11px]"
              onClick={() => setPinned((v) => !v)}
              aria-pressed={pinned}
            >
              {pinned ? 'Sabit' : 'Sabitle'}
            </button>
          </div>

          <div className="topic-rail__bar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>

          <ul className="topic-rail__list">
            {topics.map((t) => {
              const isDone = doneIds.has(t.id)
              const active = activeId === t.id
              return (
                <li key={t.id}>
                  <div
                    className={`topic-rail__row ${active ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
                  >
                    <label className="topic-rail__check">
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => onToggleDone(t.id)}
                        aria-label={`${t.title} tamamlandı`}
                      />
                    </label>
                    <button
                      type="button"
                      className="topic-rail__link"
                      onClick={() => onSelect(t.id)}
                    >
                      {t.title}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </aside>
  )
}
