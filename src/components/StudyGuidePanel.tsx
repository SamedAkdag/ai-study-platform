import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  buildStudyGuide,
  generateStudyGuide,
  loadCachedStudyGuide,
  type StudyGuide,
} from '@/lib/studyGuide'
import type { QuizItem } from '@/types/database'
import { friendlyAiError } from '@/lib/errors'

type Props = {
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  quiz?: QuizItem[] | null
  defaultOpen?: boolean
  onOpenQuiz?: () => void
}

/** NotebookLM-style study guide: AI briefing pack with local fallback. */
export default function StudyGuidePanel({
  title,
  summary,
  keyConcepts,
  markdown,
  quiz,
  defaultOpen = true,
  onOpenQuiz,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const inputKey = useMemo(
    () => ({ title, summary, keyConcepts, markdown, quiz }),
    [title, summary, keyConcepts, markdown, quiz],
  )
  const fallback = useMemo(() => buildStudyGuide(inputKey), [inputKey])
  const [guide, setGuide] = useState<StudyGuide>(() => {
    const cached = loadCachedStudyGuide(inputKey)
    return cached?.briefing ? cached : fallback
  })

  useEffect(() => {
    const cached = loadCachedStudyGuide(inputKey)
    setGuide(cached?.briefing ? cached : fallback)
  }, [inputKey, fallback])

  const genMutation = useMutation({
    mutationFn: (force: boolean) =>
      generateStudyGuide({ ...inputKey, force }),
    onSuccess: setGuide,
  })

  const autoTried = useRef('')
  useEffect(() => {
    if (!open) return
    if (guide.source === 'ai' && guide.mustKnow.length >= 3) return
    if (genMutation.isPending) return
    const key = `${title}::${(markdown || '').slice(0, 80)}`
    if (autoTried.current === key) return
    autoTried.current = key
    genMutation.mutate(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title, markdown, guide.source])

  return (
    <section className="studio-panel" aria-label="Çalışma kılavuzu">
      <button
        type="button"
        className="studio-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <p className="section-label mb-0.5">Çalışma kılavuzu</p>
          <p className="studio-panel__title">Sınava hazırlık özeti</p>
        </div>
        <span className="studio-panel__chev">{open ? 'Gizle' : 'Aç'}</span>
      </button>

      {open ? (
        <div className="studio-panel__body">
          <div className="studio-block__row mb-2">
            <p className="muted text-xs mb-0">
              {guide.source === 'ai'
                ? 'AI kılavuz'
                : genMutation.isPending
                  ? 'AI kılavuz yazılıyor…'
                  : 'Taslak kılavuz'}
            </p>
            <button
              type="button"
              className="btn-ghost text-[11px]"
              disabled={genMutation.isPending}
              onClick={() => genMutation.mutate(true)}
            >
              {genMutation.isPending ? 'Üretiliyor…' : 'Kılavuzu yenile'}
            </button>
          </div>
          {genMutation.isError ? (
            <p className="muted text-xs mb-2" role="alert">
              {friendlyAiError(genMutation.error)} — taslak gösteriliyor.
            </p>
          ) : null}

          <div className="studio-block">
            <p className="studio-block__label">Brifing</p>
            <p className="studio-block__text">{guide.briefing}</p>
          </div>

          {guide.keyTerms.length > 0 ? (
            <div className="studio-block">
              <p className="studio-block__label">Anahtar terimler</p>
              <ul className="studio-terms">
                {guide.keyTerms.map((t) => (
                  <li key={t.term}>
                    <span className="studio-terms__term">{t.term}</span>
                    <span className="studio-terms__gloss">{t.gloss}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {guide.mustKnow.length > 0 ? (
            <div className="studio-block">
              <p className="studio-block__label">Mutlaka bil</p>
              <ol className="studio-list">
                {guide.mustKnow.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {guide.quizWarmup.length > 0 ? (
            <div className="studio-block">
              <div className="studio-block__row">
                <p className="studio-block__label mb-0">Isınma soruları</p>
                {onOpenQuiz ? (
                  <button
                    type="button"
                    className="btn-ghost text-[11px]"
                    onClick={onOpenQuiz}
                  >
                    Quiz’e git →
                  </button>
                ) : null}
              </div>
              <ul className="studio-list studio-list--plain">
                {guide.quizWarmup.map((q, i) => (
                  <li key={i}>
                    <span>{q.q}</span>
                    {q.hint ? (
                      <span className="muted text-[11px]"> · {q.hint}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {guide.essayPrompts.length > 0 ? (
            <div className="studio-block">
              <p className="studio-block__label">Yazılı / sözlü deneme</p>
              <ul className="studio-list studio-list--plain">
                {guide.essayPrompts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
