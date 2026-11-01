import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import MindMapPanel from '@/components/MindMapPanel'
import {
  buildAudioOverview,
  generateAudioOverview,
  loadCachedAudioOverview,
  type AudioOverviewScript,
} from '@/lib/audioOverview'
import { friendlyAiError } from '@/lib/errors'
import type { MindMapData } from '@/types/database'
import { stopSpeech } from '@/lib/tts'

type Props = {
  chapterId: string
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  /** Chapter notes — used to generate hoca lecture, not for map tables */
  markdown?: string | null
  mindMap: MindMapData
  onRefreshMap?: () => void
  refreshingMap?: boolean
}

/**
 * Dinle: full-bleed harita dersi çalışma alanı (PDF yok).
 * “Tam sayfa” ile tüm viewport’u kaplar (OS fullscreen da dener).
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
  const inputKey = useMemo(
    () => ({ title, summary, keyConcepts, markdown }),
    [title, summary, keyConcepts, markdown],
  )
  const fallback = useMemo(() => buildAudioOverview(inputKey), [inputKey])
  const [script, setScript] = useState<AudioOverviewScript>(() => {
    const cached = loadCachedAudioOverview(inputKey)
    return cached && cached.narration.length >= 120 ? cached : fallback
  })

  useEffect(() => {
    const cached = loadCachedAudioOverview(inputKey)
    setScript(cached && cached.narration.length >= 120 ? cached : fallback)
    stopSpeech()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, summary, markdown, fallback])

  const genMutation = useMutation({
    mutationFn: (force: boolean) =>
      generateAudioOverview({ ...inputKey, force }),
    onSuccess: (next) => setScript(next),
  })

  const autoTriedKey = useRef('')
  useEffect(() => {
    if (script.source === 'ai' && script.narration.length >= 400) return
    if (genMutation.isPending) return
    const key = `${title}::${(markdown || '').slice(0, 80)}`
    if (autoTriedKey.current === key) return
    autoTriedKey.current = key
    genMutation.mutate(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, markdown, script.source])

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

  const lectureMarkdown =
    script.narration.trim().length >= 80 ? script.narration : markdown || ''

  const paragraphs = script.narration
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
            <p className="listen-lesson__eyebrow">Dinle · çalışma alanı</p>
            <h2 className="listen-lesson__title">
              {title?.trim() || 'Hoca harita turu'}
            </h2>
            {!pageFull ? (
              <p className="listen-lesson__lead">
                Karar ağacında düğüm düğüm anlatır. Sor, dinle, kaldığın yerden
                devam et — tam sayfa ile tüm ekranı kaplayabilirsin.
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
              disabled={genMutation.isPending}
              onClick={() => genMutation.mutate(true)}
            >
              {genMutation.isPending ? 'Anlatım yazılıyor…' : 'Anlatımı yenile'}
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

        {genMutation.isPending && script.source !== 'ai' ? (
          <p className="muted text-xs listen-lesson__status">
            Hoca anlatımı hazırlanıyor — harita turu taslak metinle başlayabilir…
          </p>
        ) : null}
        {genMutation.isError ? (
          <p className="listen-lesson__error text-xs" role="alert">
            {friendlyAiError(genMutation.error)} — taslak ile devam.
          </p>
        ) : null}

        <div className="listen-lesson__stage">
          <MindMapPanel
            variant="lesson"
            data={mindMap}
            title={title}
            chapterId={chapterId}
            markdown={lectureMarkdown}
            defaultCollapsed={false}
            onRefreshMap={onRefreshMap}
            refreshingMap={refreshingMap}
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
