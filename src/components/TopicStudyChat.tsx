import { useState } from 'react'

export type TopicBrief = {
  goal: string
  level: string
  depth: 'one' | 'path'
  minutes: 15 | 30 | 45 | 60 | 90
  purpose: 'exam' | 'understand' | 'homework' | 'review'
}

type Props = {
  busy?: boolean
  onCancel: () => void
  onConfirm: (brief: TopicBrief) => void
}

type Step = 'goal' | 'level' | 'purpose' | 'time' | 'depth' | 'confirm'

const LEVELS = [
  { id: 'ortaokul', label: 'Ortaokul' },
  { id: 'lise', label: 'Lise / sınav' },
  { id: 'uni', label: 'Üniversite' },
  { id: 'genel', label: 'Genel merak' },
] as const

const PURPOSES: { id: TopicBrief['purpose']; label: string; sub: string }[] = [
  { id: 'exam', label: 'Sınav', sub: 'Ayırt edici, soru kalıbı' },
  { id: 'understand', label: 'Anlamak', sub: 'Neden–nasıl bağları' },
  { id: 'homework', label: 'Ödev', sub: 'Adım adım yapılabilir' },
  { id: 'review', label: 'Tekrar', sub: 'Yoğun özet + tuzaklar' },
]

const TIMES: { id: TopicBrief['minutes']; label: string; sub: string }[] = [
  { id: 15, label: '15 dk', sub: 'Hızlı odak' },
  { id: 30, label: '30 dk', sub: 'Tek oturum' },
  { id: 45, label: '45 dk', sub: 'Derin geçiş' },
  { id: 60, label: '60 dk', sub: 'Dolu ders' },
  { id: 90, label: '90 dk', sub: 'Geniş yol' },
]

const STEPS: Step[] = ['goal', 'level', 'purpose', 'time', 'depth', 'confirm']

/**
 * Study brief — goal → level → purpose → time → depth → confirm.
 * Feeds the agentic topic curriculum pipeline.
 */
export default function TopicStudyChat({ busy, onCancel, onConfirm }: Props) {
  const [step, setStep] = useState<Step>('goal')
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('lise')
  const [purpose, setPurpose] = useState<TopicBrief['purpose']>('understand')
  const [minutes, setMinutes] = useState<TopicBrief['minutes']>(30)
  const [depth, setDepth] = useState<'one' | 'path'>('one')

  const goalOk = goal.trim().length >= 3
  const stepIdx = STEPS.indexOf(step)

  return (
    <section className="topic-chat" aria-label="Konudan çalış">
      <header className="topic-chat__head">
        <p className="topic-chat__eyebrow">PDF yok · çalışma brief’i</p>
        <h2 className="topic-chat__title">Ne öğrenmek istiyorsun?</h2>
        <p className="topic-chat__lead">
          Süre ve amacını söyle. Studium senin yerinize birden fazla uzman
          prompt’u çalıştırır: sözleşme → araştırma → zamanlı plan → kaynak.
        </p>
      </header>

      <ol className="topic-chat__steps" aria-hidden>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={
              'topic-chat__dot' +
              (step === s ? ' is-on' : '') +
              (stepIdx > i ? ' is-done' : '')
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
            placeholder="Örn. Hücre zarı ve seçici geçirgenlik · YKS organik tepkimeler · Limit tanımı ve süreklilik"
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
          <p className="topic-chat__label">Seviye</p>
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
              onClick={() => setStep('purpose')}
            >
              Devam
            </button>
          </div>
        </div>
      ) : null}

      {step === 'purpose' ? (
        <div className="topic-chat__panel">
          <p className="topic-chat__label">Bu oturumun amacı</p>
          <div className="topic-chat__choices">
            {PURPOSES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={
                  'topic-chat__choice' + (purpose === p.id ? ' is-on' : '')
                }
                disabled={busy}
                onClick={() => setPurpose(p.id)}
              >
                <strong>{p.label}</strong>
                <span>{p.sub}</span>
              </button>
            ))}
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
              onClick={() => setStep('time')}
            >
              Devam
            </button>
          </div>
        </div>
      ) : null}

      {step === 'time' ? (
        <div className="topic-chat__panel">
          <p className="topic-chat__label">Ne kadar zaman ayırıyorsun?</p>
          <div className="topic-chat__chips topic-chat__chips--wrap" role="group">
            {TIMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chip ${minutes === t.id ? 'chip-active' : 'chip-idle'}`}
                disabled={busy}
                title={t.sub}
                onClick={() => {
                  setMinutes(t.id)
                  if (t.id >= 60 && depth === 'one') setDepth('path')
                  if (t.id <= 15) setDepth('one')
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="topic-chat__hint muted text-sm">
            Süre; ünite yoğunluğunu ve kelime bütçesini belirler.
          </p>
          <div className="topic-chat__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setStep('purpose')}
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
          <p className="topic-chat__label">Nasıl ilerleyelim?</p>
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
              <span>
                {minutes} dk’ya sığan yoğun kaynak — hemen Anlatım’a gir
              </span>
            </button>
            <button
              type="button"
              className={
                'topic-chat__choice' + (depth === 'path' ? ' is-on' : '')
              }
              disabled={busy}
              onClick={() => setDepth('path')}
            >
              <strong>Öğrenme yolu</strong>
              <span>
                {minutes <= 30
                  ? '2 sıralı ünite'
                  : '3 sıralı ünite · süre ünite içine yayılır'}
              </span>
            </button>
          </div>
          <div className="topic-chat__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setStep('time')}
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
          <p className="topic-chat__label">Brief özeti</p>
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
              <span>Amaç</span>
              {PURPOSES.find((p) => p.id === purpose)?.label || purpose}
            </p>
            <p>
              <span>Süre</span>
              {minutes} dakika
            </p>
            <p>
              <span>Yapı</span>
              {depth === 'path' ? 'Öğrenme yolu' : 'Tek ünite'}
            </p>
          </div>
          <p className="topic-chat__note muted text-sm">
            90 dk gibi uzun sürelerde dakika dakika müfredat + ince detay üretilir;
            kısa sürede daha sıkı sprint. Anlatım / Alıştır bu kaynağa dayanır.
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
                  minutes,
                  purpose,
                })
              }
            >
              {busy ? 'Müfredat kuruluyor…' : 'Çalışma yolunu kur'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
