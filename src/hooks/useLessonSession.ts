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
  | 'asking'
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
  const askingRef = useRef(false)
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
    askingRef.current = false
    setProgressPct(0)
    setProgressLabel('')
  }, [mapKey])

  const ensurePlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current
    const api = createLessonPlayer()
    playerRef.current = api
    let lastNode: string | null = null
    let lastSeg = -1
    let lastWord = -2
    let lastPlaying: boolean | null = null
    let lastBuffering: boolean | null = null
    let lastDone = false
    let lastClockMs = 0
    api.subscribe((s) => {
      const focusChanged =
        s.nodeId !== lastNode || s.segmentIndex !== lastSeg
      const wordChanged = s.wordIndex !== lastWord
      const playChanged =
        s.playing !== lastPlaying ||
        s.buffering !== lastBuffering ||
        s.done !== lastDone
      // Avoid re-rendering MindMapPanel on every clock tick — only on
      // meaningful karaoke/focus changes, plus a slow clock for the strip.
      const now = performance.now()
      const clockDue = now - lastClockMs >= 500
      if (!focusChanged && !wordChanged && !playChanged && !clockDue) return

      lastNode = s.nodeId
      lastSeg = s.segmentIndex
      lastWord = s.wordIndex
      lastPlaying = s.playing
      lastBuffering = s.buffering
      lastDone = s.done
      if (clockDue) lastClockMs = now
      setPlayerState(s)

      if (!askingRef.current) {
        if (s.done) setPhase('done')
        else if (s.buffering) {
          // Stay in lesson flow — EMA is catching up on the next node
          setPhase('playing')
          setProgressLabel('Sonraki düğümün sesi hazırlanıyor…')
        } else if (s.playing) setPhase('playing')
        else if (s.currentTime > 0.05) setPhase('paused')
      }

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
    askingRef.current = false
    setFollowCamera(true)
    setCompletedIds(new Set())
    setPhase('loading_model')
    setProgressLabel('Ses modeli hazırlanıyor…')
    setProgressPct(3)

    try {
      const api = ensurePlayer()
      await api.unlock()
      if (runId !== runIdRef.current || ac.signal.aborted) return

      // EMA runs locally one segment at a time (not an AI call per node).
      // Buffer a few nodes before starting so playback doesn't stall ~10s
      // between the first and second node while the next WAV is baking.
      const startWhenReady = Math.min(3, steps.length)
      const tl = await synthesizeLessonTimeline(steps, {
        signal: ac.signal,
        lookahead: 4,
        getPlayheadIndex: () =>
          playerRef.current?.getPlayheadIndex() ?? 0,
        shouldPause: () => askingRef.current,
        onModelProgress: (p) => {
          if (runId !== runIdRef.current) return
          setPhase('loading_model')
          setProgressLabel(p.label || 'Ses modeli…')
          setProgressPct(Math.round(Math.min(0.32, p.fraction || 0) * 100))
        },
        onProgress: (p) => {
          if (runId !== runIdRef.current) return
          setPhase((prev) =>
            prev === 'playing' ||
            prev === 'paused' ||
            prev === 'asking' ||
            prev === 'done'
              ? prev
              : 'synthesizing',
          )
          setProgressLabel(
            startedPlayRef.current
              ? `Önden hazırlanıyor: ${p.label}`
              : `Tampon: ${p.label} (${p.readyCount}/${startWhenReady})`,
          )
          setProgressPct(
            Math.round(32 + (p.index / Math.max(1, p.total)) * 68),
          )
        },
        onPartial: async (partial) => {
          if (runId !== runIdRef.current) return
          setTimeline(partial)
          const player = ensurePlayer()
          player.setTimeline(partial)
          if (
            !startedPlayRef.current &&
            partial.segments.length >= startWhenReady
          ) {
            startedPlayRef.current = true
            await player.seekSegment(0)
            await player.play()
            if (runId === runIdRef.current && !askingRef.current) {
              setPhase('playing')
              setProgressLabel('Ders oynuyor')
            }
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
        if (!askingRef.current) setPhase('playing')
      } else if (!player.getState().playing && !askingRef.current) {
        setPhase('ready')
      }
    } catch (err) {
      if (runId !== runIdRef.current) return
      if ((err as DOMException)?.name === 'AbortError') {
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

  const pauseForAsk = useCallback(() => {
    const api = playerRef.current
    if (!api) return false
    if (
      phase !== 'playing' &&
      phase !== 'paused' &&
      phase !== 'ready' &&
      phase !== 'asking'
    ) {
      return false
    }
    askingRef.current = true
    api.pause()
    setPhase('asking')
    setFollowCamera(false)
    return true
  }, [phase])

  const resumeFromAsk = useCallback(async () => {
    const api = playerRef.current
    if (!api) return
    askingRef.current = false
    setFollowCamera(true)
    await api.play()
    setPhase('playing')
  }, [])

  const toggle = useCallback(async () => {
    const api = playerRef.current
    if (!api || phase === 'idle' || phase === 'error') {
      await start()
      return
    }
    if (phase === 'asking') return
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

  const seekNode = useCallback(
    async (nodeId: string) => {
      if (askingRef.current || phase === 'asking') return
      const api = playerRef.current
      if (!api) return
      await api.seekNode(nodeId)
      setFollowCamera(true)
      if (!api.getState().playing) await api.play()
    },
    [phase],
  )

  const seekSegment = useCallback(
    (i: number) => {
      if (askingRef.current || phase === 'asking') return
      void playerRef.current?.seekSegment(i)
    },
    [phase],
  )

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
    pauseForAsk,
    resumeFromAsk,
    next: () => {
      if (askingRef.current || phase === 'asking') return
      void playerRef.current?.next()
    },
    prev: () => {
      if (askingRef.current || phase === 'asking') return
      void playerRef.current?.prev()
    },
    setRate: (r: number) => playerRef.current?.setRate(r),
    seekNode,
    seekSegment,
    restart: async () => {
      askingRef.current = false
      setCompletedIds(new Set())
      setFollowCamera(true)
      await playerRef.current?.seekSegment(0)
      await playerRef.current?.play()
      setPhase('playing')
    },
    cancel: () => {
      runIdRef.current += 1
      abortRef.current?.abort()
      askingRef.current = false
      playerRef.current?.pause()
      setPhase('idle')
      setError(null)
    },
  }
}
