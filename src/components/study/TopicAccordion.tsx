import { lazy, Suspense, useId, useState } from 'react'
import StudyMarkdown from '@/components/StudyMarkdown'
import type { StudyTopic } from '@/lib/splitStudyTopics'

const TopicQuizModal = lazy(() => import('./TopicQuizModal'))

type Props = {
  topic: StudyTopic
  index?: number
  done: boolean
  onToggleDone: () => void
  registerRef?: (el: HTMLElement | null) => void
}

export default function TopicAccordion({
  topic,
  index,
  done,
  onToggleDone,
  registerRef,
}: Props) {
  const [open, setOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)
  const panelId = useId()

  const aiSimple =
    topic.summary.length > 20
      ? `Basitçe: ${topic.summary}`
      : `“${topic.title}” bölümünü kendi cümlelerinle tekrar et — ana fikir özet kartında.`

  return (
    <article
      ref={registerRef}
      id={topic.id}
      className={`topic-acc ${open ? 'is-open' : ''} ${done ? 'is-done' : ''}`}
    >
      <header className="topic-acc__head">
        <div className="topic-acc__head-main min-w-0">
          <button
            type="button"
            className="topic-acc__toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="topic-acc__chev" aria-hidden>
              {open ? '▾' : '▸'}
            </span>
            <span className="topic-acc__title">{topic.title}</span>
          </button>
        </div>
        <div className="topic-acc__tools">
          <button
            type="button"
            className="topic-acc__ai"
            onClick={() => setAiOpen((v) => !v)}
            aria-expanded={aiOpen}
          >
            ✨ AI Özetle
          </button>
          <button
            type="button"
            className="topic-acc__ai"
            onClick={() => setQuizOpen(true)}
          >
            📝 Quiz
          </button>
          <label className="topic-acc__done" title="Tamamlandı">
            <input
              type="checkbox"
              checked={done}
              onChange={onToggleDone}
              aria-label="Konuyu tamamlandı işaretle"
            />
          </label>
        </div>
      </header>

      <div
        className={`topic-acc__ai-box transition-all duration-300 ease-in-out ${
          aiOpen ? 'is-show' : ''
        }`}
      >
        {aiOpen && <p className="text-sm leading-relaxed">{aiSimple}</p>}
      </div>

      <div className="topic-acc__summary">
        <p className="muted text-[11px] font-semibold uppercase tracking-wide">
          Özet
        </p>
        <p className="mt-1 text-sm leading-relaxed">{topic.summary}</p>
        <button
          type="button"
          className="btn-ghost mt-2 text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Özeti küçült' : 'Detayları oku'}
        </button>
      </div>

      <div
        id={panelId}
        className={`topic-acc__panel transition-all duration-300 ease-in-out ${
          open ? 'is-open' : ''
        }`}
      >
        <div className="topic-acc__panel-inner prose study-textbook max-w-none text-sm">
          <StudyMarkdown markdown={topic.body} compact />
        </div>
      </div>

      {quizOpen && (
        <Suspense fallback={null}>
          <TopicQuizModal topic={topic} onClose={() => setQuizOpen(false)} />
        </Suspense>
      )}
    </article>
  )
}
