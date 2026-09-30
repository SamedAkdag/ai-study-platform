import { useEffect, useId, useState } from 'react'
import {
  markTourCompleted,
  markTourSkipped,
  shouldAutoStartTour,
} from '@/lib/productTour'

type Step = {
  id: string
  title: string
  body: string
  visual: 'upload' | 'study' | 'ask' | 'quiz' | 'share'
}

const STEPS: Step[] = [
  {
    id: 'upload',
    title: 'PDF’yi bırak, üniteler gelsin',
    body: 'Ders kitabını yükle. Studium metni çıkarır, konuları ~5 sayfalık üniteler halinde ayırır.',
    visual: 'upload',
  },
  {
    id: 'study',
    title: 'Üç derinlikte oku',
    body: 'Her ünite için özet (K1), detaylı özet (K2) ve full anlatım (K3). İhtiyacına göre seç.',
    visual: 'study',
  },
  {
    id: 'ask',
    title: 'Anlamadığın yeri seç, AI’ya sor',
    body: 'Metni seç → “Bu kısım hakkında sor”. Cevabı nota da ekleyebilirsin. Telefonda da çalışır.',
    visual: 'ask',
  },
  {
    id: 'quiz',
    title: 'Quiz çöz, skorunu gör',
    body: 'Mini quiz ile kendini kontrol et. Skoru kopyalayabilir veya gruba gönderebilirsin.',
    visual: 'quiz',
  },
  {
    id: 'share',
    title: 'Paylaş — oku veya birlikte çalış',
    body: 'Public link ile oku; gruba katılınca sohbet açılır. Private iken yalnızca sen arkadaşlara gönderebilirsin.',
    visual: 'share',
  },
]

function TourVisual({ kind }: { kind: Step['visual'] }) {
  if (kind === 'upload') {
    return (
      <div className="tour-visual" aria-hidden>
        <div className="tour-mock-drop">
          <span className="tour-mock-file">PDF</span>
          <p>Dosyayı buraya bırak</p>
        </div>
      </div>
    )
  }
  if (kind === 'study') {
    return (
      <div className="tour-visual" aria-hidden>
        <div className="tour-mock-chips">
          <span className="tour-chip on">Özet</span>
          <span className="tour-chip">Detaylı</span>
          <span className="tour-chip">Full</span>
        </div>
        <div className="tour-mock-lines">
          <i />
          <i />
          <i />
          <i className="short" />
        </div>
      </div>
    )
  }
  if (kind === 'ask') {
    return (
      <div className="tour-visual" aria-hidden>
        <p className="tour-mock-select">
          …temettü hakkı <mark>nama yazılı pay sahiplerine</mark> aittir…
        </p>
        <div className="tour-mock-btn">Bu kısım hakkında sor</div>
      </div>
    )
  }
  if (kind === 'quiz') {
    return (
      <div className="tour-visual" aria-hidden>
        <p className="tour-mock-q">1. Aşağıdakilerden hangisi doğrudur?</p>
        <div className="tour-mock-opts">
          <span className="on">A · Doğru şık</span>
          <span>B · Diğer</span>
        </div>
        <p className="tour-mock-score">Skor: 3/4</p>
      </div>
    )
  }
  return (
    <div className="tour-visual" aria-hidden>
      <div className="tour-mock-share">
        <span>Public link</span>
        <code>/s/····</code>
      </div>
      <div className="tour-mock-chips">
        <span className="tour-chip on">Oku</span>
        <span className="tour-chip">Gruba katıl</span>
      </div>
    </div>
  )
}

type Props = {
  /** Force open (e.g. from “Tur” menu). */
  open?: boolean
  onClose?: () => void
  /** Auto-start for first visitors when open is undefined. */
  auto?: boolean
}

export default function ProductTour({ open, onClose, auto = false }: Props) {
  const titleId = useId()
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (typeof open === 'boolean') {
      if (open) {
        setStep(0)
        setVisible(true)
      } else {
        setVisible(false)
      }
      return
    }
    if (auto && shouldAutoStartTour()) {
      const t = window.setTimeout(() => setVisible(true), 600)
      return () => window.clearTimeout(t)
    }
  }, [open, auto])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('skip')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close is stable enough for escape
  }, [visible])

  function close(kind: 'done' | 'skip') {
    if (kind === 'done') markTourCompleted()
    else markTourSkipped()
    setVisible(false)
    onClose?.()
  }

  if (!visible) return null

  const current = STEPS[step]!
  const last = step >= STEPS.length - 1

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) close('skip')
      }}
    >
      <div className="tour-card">
        <p className="section-label mb-2">Studium turu · {step + 1}/{STEPS.length}</p>
        <TourVisual kind={current.visual} />
        <h2 id={titleId} className="font-display mt-4 text-2xl font-semibold tracking-tight">
          {current.title}
        </h2>
        <p className="muted mt-2 text-sm leading-relaxed">{current.body}</p>

        <div className="tour-dots" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.id} className={i === step ? 'on' : ''} />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => close('skip')}
          >
            Atla
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Geri
              </button>
            )}
            {last ? (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => close('done')}
              >
                Başla
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => setStep((s) => s + 1)}
              >
                Sonraki
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
