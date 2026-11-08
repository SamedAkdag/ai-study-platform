import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import MindMapPanel from '@/components/MindMapPanel'
import LessonWaitMood from '@/components/LessonWaitMood'
import { friendlyAiError } from '@/lib/errors'
import { warmEmaSpeak } from '@/lib/emaSpeak'
import {
  generateLessonScript,
  loadCachedLessonScript,
  mergeNarrationsOntoMap,
  narrationCoverage,
  stitchLessonTranscript,
} from '@/lib/lessonScript'
import { stopSpeech } from '@/lib/tts'
import type { MindMapData } from '@/types/database'
import type { NarratedMindMapData } from '@/lib/mindmapLesson/types'

type Props = {
  chapterId: string
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  /** Chapter notes — source for map-locked teacher speech */
  markdown?: string | null
  mindMap: MindMapData
  onRefreshMap?: () => void
  refreshingMap?: boolean
}

/**
 * Dinle: full-bleed harita dersi çalışma alanı (PDF yok).
 * AI produces per-node narrations locked to the mind map; EMA warms on open.
 */
export default function ListenLessonStudio({
  chapterId,
  title,
  summary,
  keyConcepts,
  markdown,
  mindMap,
  onRefreshMap,
  refreshingMap,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pageFull, setPageFull] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [narrated, setNarrated] = useState<NarratedMindMapData | null>(() => {
    const cached = loadCachedLessonScript({
      chapterId,
      title,
      mindMap,
      markdown,
    })
    return cached?.mindMap ?? null
  })

  const mapKey = useMemo(
    () =>
      `${mindMap.central}::${mindMap.branches.map((b) => b.label).join('|')}`,
    [mindMap],
  )

  useEffect(() => {
    const cached = loadCachedLessonScript({
      chapterId,
      title,
      mindMap,
      markdown,
    })
    setNarrated(cached?.mindMap ?? null)
    stopSpeech()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, title, mapKey, markdown])

  // Warm EMA as soon as Dinle opens so “Dersi Başlat” is not a cold download.
  useEffect(() => {
    void warmEmaSpeak()
  }, [chapterId])

  const scriptMutation = useMutation({
    mutationFn: (force: boolean) =>
      generateLessonScript({
        chapterId,
        title,
        summary,
        keyConcepts,
        markdown,
        mindMap,
        force,
      }),
    onSuccess: (next) => setNarrated(next.mindMap),
  })

  const autoTriedKey = useRef('')
  useEffect(() => {
    if (narrated && narrationCoverage(narrated) >= 0.5) return
    if (scriptMutation.isPending) return
    if (mindMap.branches.length < 2) return
    const key = `${chapterId}::${mapKey}::${(markdown || '').slice(0, 80)}`
    if (autoTriedKey.current === key) return
    autoTriedKey.current = key
    scriptMutation.mutate(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, mapKey, markdown, narrated])

  useEffect(() => () => stopSpeech(), [])

  useEffect(() => {
    document.documentElement.classList.toggle('listen-page-full', pageFull)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pageFull) {
        e.preventDefault()
        void exitPageFull()
      }
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 60)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
      document.documentElement.classList.remove('listen-page-full')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFull])

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setPageFull(false)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  async function exitPageFull() {
    setPageFull(false)
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        /* ignore */
      }
    }
  }

  async function enterPageFull() {
    setPageFull(true)
    const el = rootRef.current
    if (el && typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen()
      } catch {
        /* CSS fixed overlay still covers the app */
      }
    }
  }

  const lessonMap = useMemo(
    () => mergeNarrationsOntoMap(mindMap, narrated),
    [mindMap, narrated],
  )

  const transcript =
    narrated && narrationCoverage(narrated) >= 0.35
      ? stitchLessonTranscript(narrated)
      : markdown || ''

  const scriptReady =
    !!narrated && narrationCoverage(narrated) >= 0.5 && !scriptMutation.isPending

  const paragraphs = transcript
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div
      ref={rootRef}
      className={`listen-workspace${pageFull ? ' listen-workspace--page' : ''}`}
      aria-label="Dinle çalışma alanı"
    >
      <div className="listen-lesson">
        <header className="listen-lesson__head">
          <div className="listen-lesson__intro">
            <p className="listen-lesson__eyebrow">Dinle · hoca harita turu</p>
            <h2 className="listen-lesson__title">
              {title?.trim() || 'Hoca harita turu'}
            </h2>
            {!pageFull ? (
              <p className="listen-lesson__lead">
                {scriptReady
                  ? 'Ders metni düğümlere kilitli — başlat, haritada dinle, sor, devam et.'
                  : 'Karar ağacında düğüm düğüm anlatır. Script hazırlanınca tek tıkla başla.'}
              </p>
            ) : null}
          </div>
          <div className="listen-lesson__tools">
            <button
              type="button"
              className="btn-ghost text-xs listen-lesson__full-btn"
              onClick={() => {
                if (pageFull) void exitPageFull()
                else void enterPageFull()
              }}
              aria-pressed={pageFull}
              title={
                pageFull
                  ? 'Tam sayfadan çık (Esc)'
                  : 'Anlatımı tüm ekrana yay'
              }
            >
              {pageFull ? 'Küçült' : 'Tam sayfa'}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={scriptMutation.isPending}
              onClick={() => scriptMutation.mutate(true)}
            >
              {scriptMutation.isPending
                ? 'Ders yazılıyor…'
                : 'Dersi yenile'}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setShowTranscript((v) => !v)}
            >
              {showTranscript ? 'Metni gizle' : 'Tam metin'}
            </button>
          </div>
        </header>

        {scriptReady ? (
          <p className="muted text-xs listen-lesson__status listen-lesson__status--ready">
            Ders hazır — aşağıdan «Dersi Başlat».
          </p>
        ) : null}
        {scriptMutation.isError ? (
          <p className="listen-lesson__error text-xs" role="alert">
            {friendlyAiError(scriptMutation.error)} — notlardan doldurulmuş
            anlatımla devam.
          </p>
        ) : null}

        <div className="listen-lesson__stage">
          {scriptMutation.isPending && !scriptReady ? (
            <div className="listen-lesson__wait-overlay">
              <LessonWaitMood kind="script" size="stage" />
            </div>
          ) : null}
          <MindMapPanel
            variant="lesson"
            data={lessonMap}
            title={title}
            chapterId={chapterId}
            markdown={transcript || markdown}
            defaultCollapsed={false}
            onRefreshMap={onRefreshMap}
            refreshingMap={refreshingMap}
            lessonScriptReady={scriptReady}
          />
        </div>

        {showTranscript && paragraphs.length ? (
          <article
            className="listen-lesson__transcript"
            aria-label="Hoca metni"
          >
            <p className="section-label mb-1">Hoca konuşuyor</p>
            {paragraphs.map((p, i) => (
              <p key={`${i}-${p.slice(0, 20)}`}>{p}</p>
            ))}
          </article>
        ) : null}
      </div>
    </div>
  )
}
