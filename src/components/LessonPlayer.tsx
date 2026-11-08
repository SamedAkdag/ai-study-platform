import { useRef } from 'react'
import LessonWaitMood from '@/components/LessonWaitMood'
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
  /** Waiting on next EMA segment between nodes */
  buffering?: boolean
  bufferingLong?: boolean
  canAsk?: boolean
  onAsk?: () => void
  onResumeAsk?: () => void
  /** AI map-locked script ready — stronger idle CTA */
  scriptReady?: boolean
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
  buffering = false,
  bufferingLong = false,
  canAsk = false,
  onAsk,
  onResumeAsk,
  scriptReady = false,
}: Props) {
  const touchRef = useRef<{ x: number; y: number } | null>(null)
  const busy = phase === 'loading_model' || phase === 'synthesizing'
  const asking = phase === 'asking'
  const catchingUp = buffering && !busy && !asking
  const active =
    phase === 'playing' ||
    phase === 'paused' ||
    phase === 'ready' ||
    phase === 'done' ||
    phase === 'error' ||
    phase === 'asking' ||
    busy

  const controlsLocked = asking
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
      }${asking ? ' lesson-strip--asking' : ''}`}
      onTouchStart={(e) => {
        const t = e.changedTouches[0]
        if (t) touchRef.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current
        touchRef.current = null
        const t = e.changedTouches[0]
        if (!start || !t || !active || controlsLocked) return
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
        <button
          type="button"
          className={`lesson-strip__start${
            scriptReady ? ' lesson-strip__start--ready' : ''
          }`}
          onClick={onStart}
        >
          Dersi Başlat
          <span className="lesson-strip__start-hint">
            {scriptReady
              ? 'Ders metni hazır · düğüm düğüm hoca turu'
              : 'Sinematik harita turu · düğüm yanında anlatım'}
          </span>
        </button>
      ) : (
        <>
          {busy ? (
            <div className="lesson-strip__load" role="status">
              <LessonWaitMood
                kind="audio"
                size="compact"
                detail={
                  progressPct > 0
                    ? `${progressLabel || 'Hazırlanıyor…'} · %${progressPct}`
                    : progressLabel || null
                }
              />
              <div className="lesson-strip__bar">
                <div
                  className="lesson-strip__bar-fill"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
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

          {asking ? (
            <p className="lesson-strip__ask-banner">
              Anlatım duraklatıldı · hocaya soru soruyorsun
              {onResumeAsk ? (
                <button
                  type="button"
                  className="lesson-strip__ask-resume"
                  onClick={onResumeAsk}
                >
                  Derse devam
                </button>
              ) : null}
            </p>
          ) : null}

          {catchingUp ? (
            <LessonWaitMood
              kind="buffer"
              size="compact"
              className={
                bufferingLong ? 'lesson-strip__buffer-mood--long' : undefined
              }
              detail={
                bufferingLong
                  ? 'Biraz daha bekleyebilir — ses modeli yavaşladı'
                  : null
              }
            />
          ) : null}

          {!busy && nowTitle && !captionOnMap && !asking ? (
            <p className="lesson-strip__now">
              <span className="lesson-strip__now-kicker">Şimdi</span>
              {nowTitle}
            </p>
          ) : null}

          {words.length > 0 &&
          !busy &&
          phase !== 'error' &&
          !captionOnMap &&
          !asking ? (
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
              <button
                type="button"
                className="lesson-strip__btn"
                onClick={onPrev}
                disabled={controlsLocked}
                aria-label="Önceki"
              >
                ◀
              </button>
              <button
                type="button"
                className="lesson-strip__btn lesson-strip__btn--main"
                onClick={
                  phase === 'error'
                    ? onStart
                    : asking && onResumeAsk
                      ? onResumeAsk
                      : onToggle
                }
                disabled={busy && !timeline?.segments.length && !asking}
                aria-label={asking ? 'Derse devam' : undefined}
              >
                {phase === 'error'
                  ? 'Tekrar'
                  : phase === 'playing'
                    ? '❚❚'
                    : phase === 'done'
                      ? '↻'
                      : asking
                        ? '▶'
                        : busy
                          ? '…'
                          : '▶'}
              </button>
              <button
                type="button"
                className="lesson-strip__btn"
                onClick={onNext}
                disabled={controlsLocked}
                aria-label="Sonraki"
              >
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
                disabled={controlsLocked}
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

          {canAsk && onAsk && !asking && !busy && phase !== 'error' ? (
            <button
              type="button"
              className="lesson-strip__ask"
              onClick={onAsk}
            >
              Soru sor
            </button>
          ) : null}

          {!followCamera && !asking ? (
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
                disabled={
                  exportBusy ||
                  asking ||
                  (busy && !timeline.segments.length)
                }
                onClick={onExportVideo}
              >
                {exportBusy
                  ? exportLabel || '1080p video hazırlanıyor…'
                  : exportLabel &&
                      exportLabel !== 'Video indirildi' &&
                      exportLabel !== '1080p video hazır'
                    ? exportLabel
                    : 'Videoyu indir (1080p)'}
              </button>
              {exportLabel && !exportBusy ? (
                <span className="lesson-strip__export-note">{exportLabel}</span>
              ) : null}
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
