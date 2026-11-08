import { useState } from 'react'

export type TopicBrief = {
  goal: string
  level: string
  depth: 'one' | 'path'
}

type Props = {
  busy?: boolean
  onCancel: () => void
  onConfirm: (brief: TopicBrief) => void
}

type Step = 'goal' | 'level' | 'depth' | 'confirm'

const LEVELS = [
  { id: 'ortaokul', label: 'Ortaokul' },
  { id: 'lise', label: 'Lise / sınav' },
  { id: 'uni', label: 'Üniversite' },
  { id: 'genel', label: 'Genel merak' },
] as const

/**
 * Short brief chat — collects goal → level → depth, then confirms.
 */
export default function TopicStudyChat({ busy, onCancel, onConfirm }: Props) {
  const [step, setStep] = useState<Step>('goal')
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('lise')
  const [depth, setDepth] = useState<'one' | 'path'>('one')

  const goalOk = goal.trim().length >= 3

  return (
    <section className="topic-chat" aria-label="Konudan çalış">
      <header className="topic-chat__head">
        <p className="topic-chat__eyebrow">PDF yok · konu konuş</p>
        <h2 className="topic-chat__title">Ne öğrenmek istiyorsun?</h2>
        <p className="topic-chat__lead">
          Kısa bir brief yeter. Studium üniteleri ve Anlatım / Alıştır
          araçlarını hazırlar.
        </p>
      </header>

      <ol className="topic-chat__steps" aria-hidden>
        {(['goal', 'level', 'depth', 'confirm'] as Step[]).map((s, i) => (
          <li
            key={s}
            className={
              'topic-chat__dot' +
              (step === s ? ' is-on' : '') +
              ((['goal', 'level', 'depth', 'confirm'].indexOf(step) > i
                ? ' is-done'
                : ''))
            }
          />
        ))}
      </ol>

      {step === 'goal' ? (
        <div className="topic-chat__panel">
          <label className="topic-chat__label" htmlFor="topic-goal">
            Konu veya hedef
          </label>
          <textarea
            id="topic-goal"
            className="field topic-chat__input"
            rows={3}
            autoFocus
            disabled={busy}
            placeholder="Örn. Hücre zarı ve seçici geçirgenlik · YKS organik tepkimeler"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <div className="topic-chat__actions">
            <button type="button" className="btn-ghost" onClick={onCancel}>
              Vazgeç
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!goalOk || busy}
              onClick={() => setStep('level')}
            >
              Devam
            </button>
          </div>
        </div>
      ) : null}

      {step === 'level' ? (
        <div className="topic-chat__panel">
          <p className="topic-chat__label">Seviye / amaç</p>
          <div className="topic-chat__chips" role="group">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`chip ${level === l.id ? 'chip-active' : 'chip-idle'}`}
                disabled={busy}
                onClick={() => setLevel(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="topic-chat__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setStep('goal')}
            >
              Geri
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => setStep('depth')}
            >
              Devam
            </button>
          </div>
        </div>
      ) : null}

      {step === 'depth' ? (
        <div className="topic-chat__panel">
          <p className="topic-chat__label">Ne kadar kapsam?</p>
          <div className="topic-chat__choices">
            <button
              type="button"
              className={
                'topic-chat__choice' + (depth === 'one' ? ' is-on' : '')
              }
              disabled={busy}
              onClick={() => setDepth('one')}
            >
              <strong>Tek ünite</strong>
              <span>Odaklı, hızlı başla</span>
            </button>
            <button
              type="button"
              className={
                'topic-chat__choice' + (depth === 'path' ? ' is-on' : '')
              }
              disabled={busy}
              onClick={() => setDepth('path')}
            >
              <strong>Kısa yol (3–5 ünite)</strong>
              <span>Sıralı konu yolu</span>
            </button>
          </div>
          <div className="topic-chat__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setStep('level')}
            >
              Geri
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => setStep('confirm')}
            >
              Devam
            </button>
          </div>
        </div>
      ) : null}

      {step === 'confirm' ? (
        <div className="topic-chat__panel">
          <p className="topic-chat__label">Onay</p>
          <div className="topic-chat__summary">
            <p>
              <span>Hedef</span>
              {goal.trim()}
            </p>
            <p>
              <span>Seviye</span>
              {LEVELS.find((l) => l.id === level)?.label || level}
            </p>
            <p>
              <span>Kapsam</span>
              {depth === 'path' ? '3–5 ünite yolu' : 'Tek ünite'}
            </p>
          </div>
          <p className="topic-chat__note muted text-sm">
            Genel öğretim kaynağı üretilir. PDF eklersen sonra pasajlara
            bağlanabilir.
          </p>
          <div className="topic-chat__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setStep('depth')}
            >
              Geri
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !goalOk}
              onClick={() =>
                onConfirm({
                  goal: goal.trim(),
                  level,
                  depth,
                })
              }
            >
              {busy ? 'Hazırlanıyor…' : 'Üniteleri hazırla'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
