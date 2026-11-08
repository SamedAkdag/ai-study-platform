import { useEffect, useState } from 'react'

export type LessonWaitKind =
  | 'script'
  | 'audio'
  | 'thinking'
  | 'buffer'
  | 'notes'
  | 'practice'
  | 'mindmap'
  | 'guide'
  | 'speaking'
  | 'processing'
  | 'bundle'

type Props = {
  kind: LessonWaitKind
  /** Extra line under the rotating tip (e.g. progress label) */
  detail?: string | null
  /** Override default title */
  title?: string | null
  /** compact = inline chip; stage = overlay; banner = page alert row */
  size?: 'compact' | 'stage' | 'banner'
  className?: string
}

const MOOD: Record<
  LessonWaitKind,
  { emoji: string; title: string; tips: string[] }
> = {
  script: {
    emoji: '✍️',
    title: 'Dersiniz hazırlanıyor',
    tips: [
      'Hoca haritayı düğüm düğüm yazıyor…',
      'Her başlığa kendi anlatımını oturtuyor…',
      'Birazdan tur başlayabilir…',
    ],
  },
  audio: {
    emoji: '🎧',
    title: 'Ses hazırlanıyor',
    tips: [
      'Hoca mikrofonu ayarlıyor…',
      'İlk düğümlerin sesi üretiliyor…',
      'Neredeyse hazır — sabır güzel…',
    ],
  },
  thinking: {
    emoji: '🤔',
    title: 'Hoca düşünüyor',
    tips: [
      'Sorunu tartıyor…',
      'Tahtaya bir örnek çiziyor…',
      'Az kaldı, cevap geliyor…',
    ],
  },
  buffer: {
    emoji: '⏳',
    title: 'Sıradaki düğüm hazırlanıyor',
    tips: [
      'Hoca bir sonraki konuya geçiyor…',
      'Ses tamponu dolduruluyor…',
    ],
  },
  notes: {
    emoji: '📘',
    title: 'Anlatım hazırlanıyor',
    tips: [
      'Sayfalar taranıyor…',
      'Konular sıraya diziliyor…',
      'Notlar derleniyor…',
    ],
  },
  practice: {
    emoji: '🧩',
    title: 'Alıştır hazırlanıyor',
    tips: [
      'Quiz ve örnekler yazılıyor…',
      'Flash kartlar diziliyor…',
      'Birazdan pratik başlar…',
    ],
  },
  mindmap: {
    emoji: '🗺️',
    title: 'Zihin haritası hazırlanıyor',
    tips: [
      'Ana dallar kuruluyor…',
      'Alt konular bağlanıyor…',
      'Harita şekilleniyor…',
    ],
  },
  guide: {
    emoji: '📋',
    title: 'Kılavuz hazırlanıyor',
    tips: [
      'Sınav özeti yazılıyor…',
      'Anahtar terimler seçiliyor…',
      'Brifing toparlanıyor…',
    ],
  },
  speaking: {
    emoji: '🗣️',
    title: 'Hoca okuyor',
    tips: [
      'Dinle — cümleler akıyor…',
      'İstersen durdurup devam edebilirsin…',
    ],
  },
  processing: {
    emoji: '📚',
    title: 'Kitap işleniyor',
    tips: [
      'Sayfalar okunuyor…',
      'Üniteler ayrılıyor…',
      'Bu sekmeyi açık tut…',
    ],
  },
  bundle: {
    emoji: '✨',
    title: 'Toplu üretim sürüyor',
    tips: [
      'Not + özet + detay…',
      'Alıştır ve harita da yolda…',
      'Biraz uzun sürebilir, sabır…',
    ],
  },
}

/**
 * Friendly wait surface — animated emoji + rotating tips.
 * Used for Dinle, content gen, practice, TTS, processing.
 */
export default function LessonWaitMood({
  kind,
  detail,
  title,
  size = 'compact',
  className = '',
}: Props) {
  const mood = MOOD[kind]
  const [tipIdx, setTipIdx] = useState(0)

  useEffect(() => {
    setTipIdx(0)
    if (mood.tips.length <= 1) return
    const id = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % mood.tips.length)
    }, 2800)
    return () => window.clearInterval(id)
  }, [kind, mood.tips.length])

  return (
    <div
      className={`lesson-wait lesson-wait--${size} lesson-wait--${kind}${
        className ? ` ${className}` : ''
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="lesson-wait__emoji" aria-hidden>
        {mood.emoji}
      </span>
      <div className="lesson-wait__copy">
        <p className="lesson-wait__title">{title?.trim() || mood.title}</p>
        <p className="lesson-wait__tip" key={`${kind}-${tipIdx}`}>
          {mood.tips[tipIdx]}
        </p>
        {detail ? <p className="lesson-wait__detail">{detail}</p> : null}
      </div>
      <span className="lesson-wait__dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
