import { useState } from 'react'
import {
  COACH_COPY,
  isCoachTipSeen,
  markCoachTipSeen,
  type CoachTipId,
} from '@/lib/coachTips'

type Props = {
  tipId: CoachTipId
  /** Override default copy */
  text?: string
  className?: string
}

/** One-shot guidance strip — never blocks the primary action. */
export default function CoachBanner({ tipId, text, className = '' }: Props) {
  const [visible, setVisible] = useState(() => !isCoachTipSeen(tipId))
  if (!visible) return null

  return (
    <div
      className={`coach-banner${className ? ` ${className}` : ''}`}
      role="status"
    >
      <p className="coach-banner__text">{text || COACH_COPY[tipId]}</p>
      <button
        type="button"
        className="coach-banner__dismiss"
        aria-label="Kapat"
        onClick={() => {
          markCoachTipSeen(tipId)
          setVisible(false)
        }}
      >
        Tamam
      </button>
    </div>
  )
}
