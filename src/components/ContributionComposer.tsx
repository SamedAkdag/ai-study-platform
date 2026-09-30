import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { suggestContribution } from '@/lib/api'
import {
  normalizeQuiz,
  quizTypeLabel,
  submitContribution,
  type ExplanationPayload,
} from '@/lib/contributions'
import type { GroupMember, QuizType } from '@/types/database'

type Props = {
  groupId: string
  chapterId: string
  chapterTitle: string
  membership: GroupMember
  contextExcerpt?: string
  onApplied?: () => void
}

type Mode = 'quiz' | 'example' | 'explanation'
type Source = 'manual' | 'ai'

export default function ContributionComposer({
  groupId,
  chapterId,
  chapterTitle,
  membership,
  contextExcerpt = '',
  onApplied,
}: Props) {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<Source>('manual')
  const [mode, setMode] = useState<Mode>('quiz')
  const [aiHint, setAiHint] = useState('')
  const [quizType, setQuizType] = useState<QuizType>('mcq')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', '', '', ''])
  const [correctIndex, setCorrectIndex] = useState(0)
  const [correctText, setCorrectText] = useState('')
  const [quizExpl, setQuizExpl] = useState('')
  const [problem, setProblem] = useState('')
  const [steps, setSteps] = useState('')
  const [explTitle, setExplTitle] = useState('')
  const [explBody, setExplBody] = useState('')
  const [explDepth, setExplDepth] =
    useState<ExplanationPayload['depth']>('standard')
  const [note, setNote] = useState<string | null>(null)

  const needsReview = membership.role === 'write' || membership.role === 'read'

  const aiSuggest = useMutation({
    mutationFn: () =>
      suggestContribution({
        kind: mode,
        chapterTitle,
        hint: aiHint,
        quizType,
        context: contextExcerpt,
      }),
    onSuccess: (payload) => {
      setNote('AI taslak hazır — düzenleyip gönder.')
      setSource('manual')
      if (mode === 'quiz') {
        const q = normalizeQuiz(payload as never)
        setQuizType(q.type || 'mcq')
        setQuestion(q.question)
        setOptions(
          q.type === 'mcq'
            ? [...q.options, '', '', '', ''].slice(0, 4)
            : ['', '', '', ''],
        )
        setCorrectIndex(Math.max(0, q.correct_index))
        setCorrectText(q.correct_text || '')
        setQuizExpl(q.explanation || '')
      } else if (mode === 'example') {
        setProblem(String(payload.problem || ''))
        const s = Array.isArray(payload.solution_steps)
          ? payload.solution_steps.map(String)
          : []
        setSteps(s.join('\n'))
      } else {
        setExplTitle(String(payload.title || ''))
        setExplBody(String(payload.markdown || ''))
        if (
          payload.depth === 'brief' ||
          payload.depth === 'detailed' ||
          payload.depth === 'standard'
        ) {
          setExplDepth(payload.depth)
        }
      }
    },
    onError: (err) => {
      setNote(err instanceof Error ? err.message : 'AI öneri başarısız')
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'quiz') {
        const payload = normalizeQuiz({
          type: quizType,
          question,
          options:
            quizType === 'mcq'
              ? options
              : quizType === 'true_false'
                ? ['Doğru', 'Yanlış']
                : [],
          correct_index: quizType === 'short' ? -1 : correctIndex,
          correct_text: quizType === 'short' ? correctText : null,
          explanation: quizExpl,
        })
        if (!payload.question) throw new Error('Soru metni gerekli')
        if (quizType === 'mcq' && payload.options.length < 2) {
          throw new Error('En az 2 şık gerekli')
        }
        if (quizType === 'short' && !payload.correct_text) {
          throw new Error('Kısa cevap için doğru yanıt gerekli')
        }
        return submitContribution({
          groupId,
          chapterId,
          member: membership,
          kind: 'quiz',
          payload,
        })
      }

      if (mode === 'example') {
        const solution_steps = steps
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        if (!problem.trim()) throw new Error('Örnek problemi gerekli')
        return submitContribution({
          groupId,
          chapterId,
          member: membership,
          kind: 'example',
          payload: { problem: problem.trim(), solution_steps },
        })
      }

      if (!explBody.trim()) throw new Error('Anlatım metni gerekli')
      return submitContribution({
        groupId,
        chapterId,
        member: membership,
        kind: 'explanation',
        payload: {
          depth: explDepth,
          title: explTitle.trim() || undefined,
          markdown: explBody.trim(),
        },
      })
    },
    onSuccess: async (contrib) => {
      setNote(
        contrib.status === 'approved'
          ? 'İçeriğe eklendi.'
          : 'Gönderildi — admin onayı bekleniyor.',
      )
      setQuestion('')
      setOptions(['', '', '', ''])
      setCorrectText('')
      setQuizExpl('')
      setProblem('')
      setSteps('')
      setExplTitle('')
      setExplBody('')
      setAiHint('')
      await queryClient.invalidateQueries({
        queryKey: ['chapter-contributions', chapterId],
      })
      if (contrib.status === 'approved') onApplied?.()
    },
    onError: (err) => {
      setNote(err instanceof Error ? err.message : 'Gönderilemedi')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (source === 'ai') {
      if (!aiHint.trim() && !contextExcerpt) {
        setNote('AI için kısa bir ipucu yaz')
        return
      }
      aiSuggest.mutate()
      return
    }
    submit.mutate()
  }

  return (
    <div className="surface-panel space-y-3 p-4 sm:p-5">
      <div>
        <p className="text-sm font-semibold">İçerik ekle</p>
        <p className="muted mt-1 text-xs leading-relaxed">
          Manuel yaz veya AI taslak üretsin — sonra düzenleyip gönder.
          {needsReview ? ' Yazma rolü: admin onayı gerekir.' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`chip ${source === 'manual' ? 'chip-active' : 'chip-idle'}`}
          onClick={() => setSource('manual')}
        >
          Manuel
        </button>
        <button
          type="button"
          className={`chip ${source === 'ai' ? 'chip-active' : 'chip-idle'}`}
          onClick={() => setSource('ai')}
        >
          AI ile taslak
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['quiz', 'Quiz'],
            ['example', 'Örnek'],
            ['explanation', 'Anlatım'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip ${mode === id ? 'chip-active' : 'chip-idle'}`}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        {source === 'ai' ? (
          <>
            {mode === 'quiz' && (
              <div className="flex flex-wrap gap-2">
                {(['mcq', 'true_false', 'short'] as QuizType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip ${quizType === t ? 'chip-active' : 'chip-idle'}`}
                    onClick={() => setQuizType(t)}
                  >
                    {quizTypeLabel(t)}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="field text-sm"
              rows={3}
              placeholder="AI’ye ne üretsin? Örn. temettü hakları hakkında zor bir soru"
              value={aiHint}
              onChange={(e) => setAiHint(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={aiSuggest.isPending}
            >
              {aiSuggest.isPending ? 'Üretiliyor…' : 'AI taslak oluştur'}
            </button>
          </>
        ) : (
          <>
            {mode === 'quiz' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(['mcq', 'true_false', 'short'] as QuizType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip ${quizType === t ? 'chip-active' : 'chip-idle'}`}
                      onClick={() => setQuizType(t)}
                    >
                      {quizTypeLabel(t)}
                    </button>
                  ))}
                </div>
                <textarea
                  className="field text-sm"
                  rows={2}
                  placeholder="Soru"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  required
                />
                {quizType === 'mcq' && (
                  <div className="space-y-2">
                    {options.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="correct"
                          checked={correctIndex === i}
                          onChange={() => setCorrectIndex(i)}
                        />
                        <input
                          className="field !py-2 text-sm"
                          placeholder={`Şık ${i + 1}`}
                          value={opt}
                          onChange={(e) =>
                            setOptions((prev) =>
                              prev.map((p, j) =>
                                j === i ? e.target.value : p,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
                {quizType === 'true_false' && (
                  <div className="flex gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={correctIndex === 0}
                        onChange={() => setCorrectIndex(0)}
                      />
                      Doğru
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={correctIndex === 1}
                        onChange={() => setCorrectIndex(1)}
                      />
                      Yanlış
                    </label>
                  </div>
                )}
                {quizType === 'short' && (
                  <input
                    className="field !py-2 text-sm"
                    placeholder="Beklenen kısa cevap"
                    value={correctText}
                    onChange={(e) => setCorrectText(e.target.value)}
                    required
                  />
                )}
                <input
                  className="field !py-2 text-sm"
                  placeholder="Açıklama (opsiyonel)"
                  value={quizExpl}
                  onChange={(e) => setQuizExpl(e.target.value)}
                />
              </>
            )}

            {mode === 'example' && (
              <>
                <textarea
                  className="field text-sm"
                  rows={2}
                  placeholder="Problem"
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  required
                />
                <textarea
                  className="field text-sm"
                  rows={4}
                  placeholder="Çözüm adımları (her satır bir adım)"
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                />
              </>
            )}

            {mode === 'explanation' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['brief', 'Özet'],
                      ['standard', 'Genel'],
                      ['detailed', 'Detay'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`chip ${explDepth === id ? 'chip-active' : 'chip-idle'}`}
                      onClick={() => setExplDepth(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  className="field !py-2 text-sm"
                  placeholder="Başlık (opsiyonel)"
                  value={explTitle}
                  onChange={(e) => setExplTitle(e.target.value)}
                />
                <textarea
                  className="field text-sm"
                  rows={5}
                  placeholder="Markdown anlatım eki"
                  value={explBody}
                  onChange={(e) => setExplBody(e.target.value)}
                  required
                />
              </>
            )}

            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={submit.isPending}
            >
              {submit.isPending
                ? 'Gönderiliyor…'
                : needsReview
                  ? 'Onaya gönder'
                  : 'Üniteye ekle'}
            </button>
          </>
        )}
        {note && <p className="muted text-xs">{note}</p>}
      </form>
    </div>
  )
}
