import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { StudyTopic } from '@/lib/splitStudyTopics'

export type StudyNavChapter = {
  id: string
  title: string
  href: string
  ready?: boolean
}

export type StudyTopicNav = {
  topics: StudyTopic[]
  doneIds: Set<string>
  activeId: string | null
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
}

type Props = {
  bookTitle: string
  bookHref: string
  chapters: StudyNavChapter[]
  activeChapterId?: string | null
  /** Topic TOC when reading (Anlatım). */
  topicNav?: StudyTopicNav | null
  /**
   * Studio strip (mind map, guide, audio) — keeps center free for Anlatım.
   * When set, panel opens wider and starts pinned.
   */
  studio?: ReactNode
}

/**
 * Left study nav: units + optional studio tools.
 * Peek tab (İçindekiler) stays visible; pin or hover opens the flyout.
 */
export default function StudyLeftNav({
  bookTitle,
  bookHref,
  chapters,
  activeChapterId,
  topicNav = null,
  studio = null,
}: Props) {
  const hasStudio = !!studio
  const [pinned, setPinned] = useState(hasStudio)
  useEffect(() => {
    if (hasStudio) setPinned(true)
  }, [hasStudio])
  const topics = topicNav?.topics ?? []
  const done = topicNav
    ? topics.filter((t) => topicNav.doneIds.has(t.id)).length
    : 0
  const totalTopics = topics.length
  const pct =
    totalTopics === 0 ? 0 : Math.round((done / totalTopics) * 100)
  const peekLabel = studio ? 'Araçlar' : 'İçindekiler'

  return (
    <aside
      className={`study-nav ${pinned ? 'is-open' : ''} ${
        studio ? 'study-nav--studio' : ''
      }`}
      aria-label="Çalışma gezgini"
    >
      <div className="study-nav__hit" aria-hidden />

      <button
        type="button"
        className="study-nav__peek"
        title={peekLabel}
        aria-expanded={pinned}
        aria-controls="study-nav-flyout"
        onClick={() => setPinned((v) => !v)}
      >
        <span className="study-nav__grip" aria-hidden />
        <span className="study-nav__peek-label">{peekLabel}</span>
      </button>

      <div className="study-nav__sheet" id="study-nav-flyout">
        <div className="study-nav__flyout">
          <div className="study-nav__head">
            <div className="min-w-0">
              <Link to={bookHref} className="study-nav__book">
                ← {bookTitle || 'Kitap'}
              </Link>
              <p className="study-nav__heading">{peekLabel}</p>
            </div>
            <button
              type="button"
              className="btn-ghost text-[11px] shrink-0"
              onClick={() => setPinned((v) => !v)}
              aria-pressed={pinned}
            >
              {pinned ? 'Sabit' : 'Sabitle'}
            </button>
          </div>

          {chapters.length > 0 && (
            <section className="study-nav__section" aria-label="Üniteler">
              <p className="study-nav__section-label">Üniteler</p>
              <ul className="study-nav__list">
                {chapters.map((c) => {
                  const active = c.id === activeChapterId
                  return (
                    <li key={c.id}>
                      <Link
                        to={c.href}
                        className={`study-nav__link ${active ? 'is-active' : ''} ${
                          c.ready === false ? 'is-dim' : ''
                        }`}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span className="study-nav__link-text">{c.title}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {topicNav && totalTopics > 0 && (
            <section className="study-nav__section" aria-label="Konular">
              <div className="study-nav__section-row">
                <p className="study-nav__section-label">Bu ünitede</p>
                <p className="study-nav__meta">
                  {done}/{totalTopics}
                </p>
              </div>
              <div className="study-nav__bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </div>
              <ul className="study-nav__list">
                {topics.map((t) => {
                  const isDone = topicNav.doneIds.has(t.id)
                  const active = topicNav.activeId === t.id
                  return (
                    <li key={t.id}>
                      <div
                        className={`study-nav__row ${active ? 'is-active' : ''} ${
                          isDone ? 'is-done' : ''
                        }`}
                      >
                        <label className="study-nav__check">
                          <input
                            type="checkbox"
                            checked={isDone}
                            onChange={() => topicNav.onToggleDone(t.id)}
                            aria-label={`${t.title} tamamlandı`}
                          />
                        </label>
                        <button
                          type="button"
                          className="study-nav__topic"
                          onClick={() => topicNav.onSelect(t.id)}
                        >
                          {t.title}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {studio ? (
            <section className="study-nav__studio" aria-label="Çalışma araçları">
              <p className="study-nav__section-label">Bu ünite</p>
              <div className="chapter-studio chapter-studio--rail">{studio}</div>
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
