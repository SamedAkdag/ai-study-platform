import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  generateMorePractice,
  type PracticeDifficulty,
} from '@/lib/api'
import type { ExampleItem, QuizItem } from '@/types/database'
import { friendlyAiError } from '@/lib/errors'

const LEVELS: Array<{ id: PracticeDifficulty; label: string }> = [
  { id: 'easy', label: 'Kolay' },
  { id: 'medium', label: 'Orta' },
  { id: 'hard', label: 'Zor' },
]

const COUNT_OPTIONS = [3, 5, 8, 10] as const

type Props = {
  kind: 'quiz' | 'example'
  chapterTitle: string
  context?: string
  avoid?: string[]
  difficulty: PracticeDifficulty
  onDifficultyChange: (d: PracticeDifficulty) => void
  onGenerated: (result: {
    quiz?: QuizItem[]
    examples?: ExampleItem[]
  }) => void
}

export default function PracticeMoreBar({
  kind,
  chapterTitle,
  context,
  avoid,
  difficulty,
  onDifficultyChange,
  onGenerated,
}: Props) {
  const [count, setCount] = useState(5)

  const mutation = useMutation({
    mutationFn: () =>
      generateMorePractice({
        kind,
        chapterTitle,
        difficulty,
        count,
        context,
        avoid,
      }),
    onSuccess: (result) => onGenerated(result),
  })

  const unit = kind === 'quiz' ? 'soru' : 'örnek'
  const cta =
    kind === 'quiz'
      ? `${count} yeni soru ekle`
      : `${count} yeni çözümlü ekle`
  const pendingLabel =
    kind === 'quiz' ? 'Sorular üretiliyor…' : 'Örnekler üretiliyor…'

  return (
    <div className="practice-more">
      <div className="practice-more__row">
        <p className="practice-more__label">Zorluk</p>
        <div
          className="mode-segment mode-segment--secondary"
          role="radiogroup"
          aria-label="Zorluk"
        >
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={difficulty === l.id}
              className={`chip ${difficulty === l.id ? 'chip-active' : 'chip-idle'}`}
              disabled={mutation.isPending}
              onClick={() => onDifficultyChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="practice-more__row">
        <p className="practice-more__label">Adet</p>
        <div
          className="mode-segment mode-segment--secondary"
          role="radiogroup"
          aria-label={`${unit} sayısı`}
        >
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={count === n}
              className={`chip ${count === n ? 'chip-active' : 'chip-idle'}`}
              disabled={mutation.isPending}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <label className="practice-more__custom">
          <span className="sr-only">Özel adet</span>
          <input
            type="number"
            className="field practice-more__count-input"
            min={1}
            max={10}
            value={count}
            disabled={mutation.isPending}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setCount(Math.min(10, Math.max(1, Math.round(n))))
            }}
          />
        </label>
      </div>

      <div className="practice-more__actions">
        <button
          type="button"
          className="btn-primary"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? pendingLabel : cta}
        </button>
        <p className="muted text-xs">
          Mevcut {kind === 'quiz' ? 'sorular' : 'örnekler'} kalır; yeniler
          alta eklenir.
        </p>
      </div>
      {mutation.isError ? (
        <p className="practice-more__error text-xs" role="alert">
          {friendlyAiError(mutation.error)}
        </p>
      ) : null}
    </div>
  )
}
