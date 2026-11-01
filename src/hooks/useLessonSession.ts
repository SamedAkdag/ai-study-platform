import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MindMapData } from '@/types/database'
import { buildLessonSteps } from '@/lib/mindmapLesson/buildTimeline'
import { synthesizeLessonTimeline } from '@/lib/mindmapLesson/lessonTts'
import {
  createLessonPlayer,
  type LessonPlayerApi,
  type LessonPlayerState,
} from '@/lib/mindmapLesson/player'
import type { LessonTimeline } from '@/lib/mindmapLesson/types'

export type LessonPhase =
  | 'idle'
  | 'loading_model'
  | 'synthesizing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'done'
  | 'error'

export function useLessonSession(input: {
  data: MindMapData
  markdown?: string | null
  title?: string
}) {
  const steps = useMemo(
    () =>
      buildLessonSteps(input.data, {
        markdown: input.markdown,
        unitTitle: input.title,
      }),
    [input.data, input.markdown, input.title],
  )

  const [phase, setPhase] = useState<LessonPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progressLabel, setProgressLabel] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [timeline, setTimeline] = useState<LessonTimeline | null>(null)
  const [playerState, setPlayerState] = useState<LessonPlayerState | null>(null)
  const [followCamera, setFollowCamera] = useState(true)
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set())

  const playerRef = useRef<LessonPlayerApi | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedPlayRef = useRef(false)
  const runIdRef = useRef(0)
  const mapKey = `${input.data.central}::${input.data.branches.map((b) => b.label).join('|')}`
  const mapKeyRef = useRef(mapKey)

  useEffect(() => {
    return () => {
      runIdRef.current += 1
      abortRef.current?.abort()
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (mapKeyRef.current === mapKey) return
    mapKeyRef.current = mapKey
    runIdRef.current += 1
    abortRef.current?.abort()
    playerRef.current?.destroy()
    playerRef.current = null
    setTimeline(null)
    setPlayerState(null)
    setPhase('idle')
    setError(null)
    setCompletedIds(new Set())
    setFollowCamera(true)
    startedPlayRef.current = false
    setProgressPct(0)
    setProgressLabel('')
  }, [mapKey])

  const ensurePlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current
    const api = createLessonPlayer()
    playerRef.current = api
    let lastNode: string | null = null
    let lastSeg = -1
    let lastPlaying: boolean | null = null
    api.subscribe((s) => {
      const focusChanged =
        s.nodeId !== lastNode || s.segmentIndex !== lastSeg
      const playChanged = s.playing !== lastPlaying || s.done
      // Always refresh clock lightly; force React update on focus/play changes
      if (focusChanged || playChanged || s.done) {
        lastNode = s.nodeId
        lastSeg = s.segmentIndex
        lastPlaying = s.playing
        setPlayerState(s)
        if (s.done) setPhase('done')
        else if (s.playing) setPhase('playing')
        else if (s.currentTime > 0.05) setPhase('paused')

        if (focusChanged && s.nodeId) {
          setCompletedIds((prev) => {
            const tl = api.getTimelineSnapshot()
            const next = new Set<string>()
            for (const seg of tl.segments) {
              if (seg.nodeId === s.nodeId) continue
              if (seg.end <= s.currentTime + 0.05) next.add(seg.nodeId)
            }
            if (
              prev.size === next.size &&
              [...next].every((id) => prev.has(id))
            ) {
              return prev
            }
            return next
          })
        }
      } else {
        // Throttled clock for karaoke without rebuilding the map
        setPlayerState(s)
      }
    })
    return api
  }, [])

  const start = useCallback(async () => {
    if (!steps.length) {
      setError('Ders adımları oluşturulamadı')
      setPhase('error')
      return
    }

    const runId = ++runIdRef.current
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setError(null)
    startedPlayRef.current = false
    setFollowCamera(true)
    setCompletedIds(new Set())
    // Show UI immediately — before any await
    setPhase('loading_model')
    setProgressLabel('Ses modeli hazırlanıyor…')
    setProgressPct(3)

    try {
      const api = ensurePlayer()
      await api.unlock()
      if (runId !== runIdRef.current || ac.signal.aborted) return

      const tl = await synthesizeLessonTimeline(steps, {
        signal: ac.signal,
        onModelProgress: (p) => {
          if (runId !== runIdRef.current) return
          setPhase('loading_model')
          setProgressLabel(p.label || 'Ses modeli…')
          setProgressPct(Math.round(Math.min(0.32, p.fraction || 0) * 100))
        },
        onProgress: (p) => {
          if (runId !== runIdRef.current) return
          // Don't yank UI out of "playing" once audio has started —
          // later segments keep synthesizing in the background.
          setPhase((prev) =>
            prev === 'playing' || prev === 'paused' || prev === 'done'
              ? prev
              : 'synthesizing',
          )
          setProgressLabel(p.label)
          setProgressPct(
            Math.round(32 + (p.index / Math.max(1, p.total)) * 68),
          )
        },
        onPartial: async (partial) => {
          if (runId !== runIdRef.current) return
          setTimeline(partial)
          const player = ensurePlayer()
          player.setTimeline(partial)
          if (!startedPlayRef.current && partial.segments.length >= 1) {
            startedPlayRef.current = true
            await player.seekSegment(0)
            await player.play()
            if (runId === runIdRef.current) setPhase('playing')
          }
        },
      })

      if (runId !== runIdRef.current || ac.signal.aborted) return

      setTimeline(tl)
      const player = ensurePlayer()
      player.setTimeline(tl, { markDone: true })
      setProgressPct(100)
      setProgressLabel('Hazır')

      if (!tl.segments.length) {
        setPhase('error')
        setError(
          'Ses üretilemedi. Bağlantıyı kontrol edip tekrar deneyin.',
        )
        return
      }

      if (!startedPlayRef.current) {
        startedPlayRef.current = true
        await player.seekSegment(0)
        await player.play()
        setPhase('playing')
      } else if (!player.getState().playing) {
        setPhase('ready')
      }
    } catch (err) {
      if (runId !== runIdRef.current) return
      if ((err as DOMException)?.name === 'AbortError') {
        // Only hide UI if a newer run replaced this one
        return
      }
      console.error('[lesson]', err)
      setPhase('error')
      setError(
        err instanceof Error
          ? err.message
          : 'Ses modeli yüklenemedi, tekrar deneyin',
      )
    }
  }, [ensurePlayer, steps])

  const toggle = useCallback(async () => {
    const api = playerRef.current
    if (!api || phase === 'idle' || phase === 'error') {
      await start()
      return
    }
    if (phase === 'done') {
      await api.seekSegment(0)
      await api.play()
      setPhase('playing')
      return
    }
    const s = api.getState()
    if (s.playing) {
      api.pause()
      setPhase('paused')
    } else {
      await api.play()
      setPhase('playing')
    }
  }, [phase, start])

  const seekNode = useCallback(async (nodeId: string) => {
    const api = playerRef.current
    if (!api) return
    await api.seekNode(nodeId)
    setFollowCamera(true)
    if (!api.getState().playing) await api.play()
  }, [])

  return {
    steps,
    phase,
    error,
    progressLabel,
    progressPct,
    timeline,
    playerState,
    activeNodeId: playerState?.nodeId ?? null,
    activeCamera: playerState?.camera ?? 'hub',
    activeWordIndex: playerState?.wordIndex ?? -1,
    completedIds,
    followCamera,
    setFollowCamera,
    start,
    toggle,
    next: () => void playerRef.current?.next(),
    prev: () => void playerRef.current?.prev(),
    setRate: (r: number) => playerRef.current?.setRate(r),
    seekNode,
    seekSegment: (i: number) => void playerRef.current?.seekSegment(i),
    restart: async () => {
      setCompletedIds(new Set())
      setFollowCamera(true)
      await playerRef.current?.seekSegment(0)
      await playerRef.current?.play()
      setPhase('playing')
    },
    cancel: () => {
      runIdRef.current += 1
      abortRef.current?.abort()
      playerRef.current?.pause()
      setPhase('idle')
      setError(null)
    },
  }
}
