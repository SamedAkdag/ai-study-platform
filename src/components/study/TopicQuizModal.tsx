import { useMemo, useState } from 'react'
import type { StudyTopic } from '@/lib/splitStudyTopics'

type Props = {
  topic: StudyTopic
  onClose: () => void
}

type Q = {
  prompt: string
  choices: string[]
  correct: number
}

/** Tiny local MCQ from topic text — no network, no heavy UI. */
function buildQuiz(topic: StudyTopic): Q {
  const plain = topic.body
    .replace(/[*_`#>|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sentences = plain
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 28)
  const focus = sentences[0] || topic.summary || topic.title
  const keyword =
    focus
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .slice(0, 1)[0]
      ?.replace(/[.,;:]$/, '') || topic.title.split(/\s+/).slice(-1)[0]

  const prompt = `“${topic.title}” için doğru olan hangisidir?`
  const correctChoice = focus.slice(0, 110) + (focus.length > 110 ? '…' : '')
  const distractors = [
    `${keyword} yalnızca ezberlenmesi gereken bir tanımdır; pratikte kullanılmaz.`,
    `Bu konu sınavda hiç sorulmaz; atlanabilir.`,
    `Kaldıraç ve teminat kavramları birbiriyle tamamen bağımsızdır.`,
  ]

  const choices = [correctChoice, ...distractors].slice(0, 4)
  // shuffle stably by title length
  const seed = topic.title.length % 4
  const rotated = [
    ...choices.slice(seed),
    ...choices.slice(0, seed),
  ]
  const correct = rotated.indexOf(correctChoice)

  return { prompt, choices: rotated, correct: correct < 0 ? 0 : correct }
}

export default function TopicQuizModal({ topic, onClose }: Props) {
  const quiz = useMemo(() => buildQuiz(topic), [topic])
  const [picked, setPicked] = useState<number | null>(null)

  return (
    <div
      className="topic-quiz-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quiz"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="topic-quiz-card transition-all duration-300 ease-in-out">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="section-label mb-1">Hızlı quiz</p>
            <p className="font-display text-base font-semibold leading-snug">
              {topic.title}
            </p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            Kapat
          </button>
        </div>
        <p className="text-sm leading-relaxed">{quiz.prompt}</p>
        <ul className="mt-3 space-y-2">
          {quiz.choices.map((c, i) => {
            const show = picked !== null
            const ok = i === quiz.correct
            const wrong = show && picked === i && !ok
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={picked !== null}
                  className={`topic-quiz-choice transition-all duration-300 ease-in-out ${
                    show && ok ? 'is-correct' : ''
                  } ${wrong ? 'is-wrong' : ''}`}
                  onClick={() => setPicked(i)}
                >
                  <span className="font-semibold">{String.fromCharCode(65 + i)}.</span>{' '}
                  {c}
                </button>
              </li>
            )
          })}
        </ul>
        {picked !== null && (
          <p className="muted mt-3 text-xs">
            {picked === quiz.correct
              ? 'Doğru — kısa bir kontrol yeterli.'
              : 'Tekrar oku; özet kartına dönüp detayı açabilirsin.'}
          </p>
        )}
      </div>
    </div>
  )
}
