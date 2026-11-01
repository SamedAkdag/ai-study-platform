import { useRef } from 'react'
import type { LessonPhase } from '@/hooks/useLessonSession'
import type { LessonTimeline } from '@/lib/mindmapLesson/types'

type Props = {
  phase: LessonPhase
  error: string | null
  progressLabel: string
  progressPct: number
  timeline: LessonTimeline | null
  currentTime: number
  segmentIndex: number
  wordIndex: number
  rate: number
  followCamera: boolean
  onStart: () => void
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
  onSeekSegment: (i: number) => void
  onSetRate: (r: number) => void
  onRestart: () => void
  onFollowCamera: () => void
  onExportVideo?: () => void
  exportBusy?: boolean
  exportLabel?: string
  /** Karaoke lives on the map bubble — strip stays controls-only */
  captionOnMap?: boolean
}

const RATES = [0.75, 1, 1.25, 1.5] as const

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function LessonPlayer({
  phase,
  error,
  progressLabel,
  progressPct,
  timeline,
  currentTime,
  segmentIndex,
  wordIndex,
  rate,
  followCamera,
  onStart,
  onToggle,
  onPrev,
  onNext,
  onSeekSegment,
  onSetRate,
  onRestart,
  onFollowCamera,
  onExportVideo,
  exportBusy = false,
  exportLabel = '',
  captionOnMap = false,
}: Props) {
  const touchRef = useRef<{ x: number; y: number } | null>(null)
  const busy = phase === 'loading_model' || phase === 'synthesizing'
  const active =
    phase === 'playing' ||
    phase === 'paused' ||
    phase === 'ready' ||
    phase === 'done' ||
    phase === 'error' ||
    busy

  const seg = timeline?.segments[segmentIndex]
  const segWords = (timeline?.words ?? []).filter((w) => w.segmentId === seg?.id)
  let localWord = -1
  for (let i = 0; i < segWords.length; i++) {
    if (segWords[i]!.s <= currentTime) localWord = i
    else break
  }
  const words = segWords.length
    ? segWords.map((w) => w.w)
    : (seg?.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const highlight = segWords.length ? localWord : wordIndex
  const nowTitle = seg?.title || ''

  return (
    <div
      className={`lesson-strip${active ? ' lesson-strip--active' : ''}${
        captionOnMap ? ' lesson-strip--cinema' : ''
      }`}
      onTouchStart={(e) => {
        const t = e.changedTouches[0]
        if (t) touchRef.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current
        touchRef.current = null
        const t = e.changedTouches[0]
        if (!start || !t || !active) return
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) {
          if (Math.abs(dx) < 12 && Math.abs(dy) < 12) onToggle()
          return
        }
        if (dx < 0) onNext()
        else onPrev()
      }}
    >
      {!active ? (
        <button type="button" className="lesson-strip__start" onClick={onStart}>
          Dersi Başlat
          <span className="lesson-strip__start-hint">
            Sinematik harita turu · düğüm yanında anlatım
          </span>
        </button>
      ) : (
        <>
          {busy ? (
            <div className="lesson-strip__load" role="status">
              <div className="lesson-strip__bar">
                <div
                  className="lesson-strip__bar-fill"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
              <span className="lesson-strip__load-label">
                {progressLabel || 'Hazırlanıyor…'}
                {progressPct > 0 ? ` · %${progressPct}` : ''}
              </span>
            </div>
          ) : null}

          {phase === 'error' || error ? (
            <p className="lesson-strip__error" role="alert">
              <span>{error || 'Ses modeli yüklenemedi, tekrar deneyin'}</span>
              <button type="button" className="btn-ghost text-xs" onClick={onStart}>
                Tekrar dene
              </button>
            </p>
          ) : null}

          {!busy && nowTitle && !captionOnMap ? (
            <p className="lesson-strip__now">
              <span className="lesson-strip__now-kicker">Şimdi</span>
              {nowTitle}
            </p>
          ) : null}

          {words.length > 0 && !busy && phase !== 'error' && !captionOnMap ? (
            <p className="lesson-strip__caption" aria-live="off">
              {words.map((w, i) => (
                <span
                  key={`${i}-${w}`}
                  className={
                    i === highlight
                      ? 'lesson-strip__kw lesson-strip__kw--on'
                      : i < highlight
                        ? 'lesson-strip__kw lesson-strip__kw--past'
                        : 'lesson-strip__kw'
                  }
                >
                  {w}{' '}
                </span>
              ))}
            </p>
          ) : null}

          <div className="lesson-strip__row">
            <div className="lesson-strip__controls">
              <button type="button" className="lesson-strip__btn" onClick={onPrev} aria-label="Önceki">
                ◀
              </button>
              <button
                type="button"
                className="lesson-strip__btn lesson-strip__btn--main"
                onClick={phase === 'error' ? onStart : onToggle}
                disabled={busy && !timeline?.segments.length}
              >
                {phase === 'error'
                  ? 'Tekrar'
                  : phase === 'playing'
                    ? '❚❚'
                    : phase === 'done'
                      ? '↻'
                      : busy
                        ? '…'
                        : '▶'}
              </button>
              <button type="button" className="lesson-strip__btn" onClick={onNext} aria-label="Sonraki">
                ▶
              </button>
            </div>

            <div className="lesson-strip__scrub">
              <input
                type="range"
                min={0}
                max={Math.max(0, (timeline?.segments.length ?? 1) - 1)}
                step={1}
                value={Math.min(
                  segmentIndex,
                  Math.max(0, (timeline?.segments.length ?? 1) - 1),
                )}
                aria-label="Ders ilerlemesi"
                onChange={(e) => onSeekSegment(Number(e.target.value))}
              />
              <span className="lesson-strip__time">
                {fmt(currentTime)} / {fmt(timeline?.totalDuration ?? 0)}
              </span>
            </div>

            <div className="lesson-strip__rates">
              {RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`lesson-strip__rate${
                    Math.abs(rate - r) < 0.01 ? ' lesson-strip__rate--on' : ''
                  }`}
                  onClick={() => onSetRate(r)}
                >
                  {r}×
                </button>
              ))}
            </div>
          </div>

          {!followCamera ? (
            <button
              type="button"
              className="lesson-strip__follow"
              onClick={onFollowCamera}
            >
              Dersi takip et
            </button>
          ) : null}

          {onExportVideo && timeline?.segments.length ? (
            <div className="lesson-strip__export">
              <button
                type="button"
                className="lesson-strip__export-btn"
                disabled={exportBusy || busy}
                onClick={onExportVideo}
              >
                {exportBusy ? exportLabel || 'Video hazırlanıyor…' : 'Videoyu indir'}
              </button>
            </div>
          ) : null}

          {phase === 'done' ? (
            <div className="lesson-strip__done">
              <span>Ders tamamlandı</span>
              <button type="button" className="btn-primary text-xs" onClick={onRestart}>
                Baştan izle
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
