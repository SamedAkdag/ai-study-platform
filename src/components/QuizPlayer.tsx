import { useMemo, useState } from 'react'
import { quizTypeLabel } from '@/lib/contributions'
import type { QuizItem } from '@/types/database'

type Props = {
  quiz: QuizItem[]
  bookTitle?: string
  chapterTitle?: string
  onScored?: (ok: number, total: number) => void
  onShareScore?: (ok: number, total: number) => void | Promise<void>
}

export default function QuizPlayer({
  quiz,
  bookTitle,
  chapterTitle,
  onScored,
  onShareScore,
}: Props) {
  const [answers, setAnswers] = useState<Record<number, number | string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [shareNote, setShareNote] = useState<string | null>(null)

  const score = useMemo(() => {
    if (!submitted) return null
    let ok = 0
    quiz.forEach((q, i) => {
      if (q.type === 'short') {
        const a = String(answers[i] ?? '')
          .trim()
          .toLowerCase()
        const expect = String(q.correct_text ?? '')
          .trim()
          .toLowerCase()
        if (a && expect && a === expect) ok += 1
      } else if (answers[i] === q.correct_index) {
        ok += 1
      }
    })
    return { ok, total: quiz.length }
  }, [answers, quiz, submitted])

  if (!quiz.length) {
    return <p className="muted">Henüz quiz yok.</p>
  }

  async function shareScore() {
    if (!score) return
    const line = `Studium quiz: “${chapterTitle || 'Ünite'}”${
      bookTitle ? ` · ${bookTitle}` : ''
    } → ${score.ok}/${score.total}`
    try {
      if (onShareScore) {
        await onShareScore(score.ok, score.total)
        setShareNote('Skor paylaşıldı ✓')
      } else {
        await navigator.clipboard.writeText(line)
        setShareNote('Skor panoya kopyalandı ✓')
      }
    } catch {
      window.prompt('Skoru kopyala:', line)
    }
    window.setTimeout(() => setShareNote(null), 2200)
  }

  return (
    <div className="space-y-6">
      {!submitted && (
        <p className="muted text-xs">
          Cevapları seç, sonra kontrol et — skorun hemen görünür.
        </p>
      )}
      {quiz.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="muted text-[11px] font-semibold tracking-wide uppercase">
            {quizTypeLabel(q.type)}
          </p>
          <p className="font-display font-semibold">
            {i + 1}. {q.question}
          </p>
          {q.type === 'short' ? (
            <input
              className="field text-sm"
              disabled={submitted}
              placeholder="Cevabını yaz…"
              value={String(answers[i] ?? '')}
              onChange={(e) =>
                setAnswers((a) => ({ ...a, [i]: e.target.value }))
              }
            />
          ) : (
            <div className="space-y-1.5">
              {(q.options ?? []).map((opt, oi) => {
                const selected = answers[i] === oi
                let border = 'var(--line)'
                let bg = '#fff'
                if (submitted) {
                  if (oi === q.correct_index) {
                    border = 'rgba(11, 90, 84, 0.45)'
                    bg = 'var(--accent-soft)'
                  } else if (selected) {
                    border = 'rgba(163, 61, 61, 0.4)'
                    bg = 'var(--danger-soft)'
                  }
                } else if (selected) {
                  border = 'var(--accent-deep)'
                  bg = 'var(--highlight)'
                }
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={submitted}
                    onClick={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                    className="block w-full rounded-xl border px-3 py-2.5 text-left text-sm transition"
                    style={{ borderColor: border, background: bg }}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          )}
          {submitted && (
            <p className="muted text-xs">
              {q.type === 'short' && q.correct_text
                ? `Beklenen: ${q.correct_text}. `
                : ''}
              {q.explanation}
            </p>
          )}
        </div>
      ))}

      {!submitted ? (
        <button
          type="button"
          onClick={() => {
            setSubmitted(true)
            let ok = 0
            quiz.forEach((q, i) => {
              if (q.type === 'short') {
                const a = String(answers[i] ?? '')
                  .trim()
                  .toLowerCase()
                const expect = String(q.correct_text ?? '')
                  .trim()
                  .toLowerCase()
                if (a && expect && a === expect) ok += 1
              } else if (answers[i] === q.correct_index) {
                ok += 1
              }
            })
            onScored?.(ok, quiz.length)
          }}
          className="btn-primary"
        >
          Kontrol et
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-display text-lg font-semibold">
            Skor: {score?.ok}/{score?.total}
          </p>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setAnswers({})
              setSubmitted(false)
              setShareNote(null)
            }}
          >
            Yeniden çöz
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => void shareScore()}
          >
            {onShareScore ? 'Skoru gruba gönder' : 'Skoru kopyala'}
          </button>
          {shareNote && <p className="muted text-[11px]">{shareNote}</p>}
        </div>
      )}
    </div>
  )
}
