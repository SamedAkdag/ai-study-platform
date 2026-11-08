import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeMouseHandler,
  type ReactFlowInstance,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { MindMapData, PageSource } from '@/types/database'
import {
  buildMindMapTopicDetail,
  type MindMapTopicDetail,
} from '@/lib/mindMapTopicDetail'
import {
  locateMindMapInPdf,
  type MindMapPdfHit,
} from '@/lib/mindMapPdfLocate'
import { normalizeMindMapTopics, toTopicLabel } from '@/lib/mindMapTopics'
import {
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  isTtsSupported,
  speakText,
  stopSpeech,
} from '@/lib/tts'
import StudyMarkdown from '@/components/StudyMarkdown'
import LessonAskPanel from '@/components/LessonAskPanel'
import LessonPlayer from '@/components/LessonPlayer'
import LessonWaitMood from '@/components/LessonWaitMood'
import LessonSpeechBubble from '@/components/LessonSpeechBubble'
import {
  fitLessonFrame,
  lessonEdgeHighlight,
  lessonFrameIds,
  lessonOpenAllBranches,
  lessonPathIds,
} from '@/components/MindMapSync'
import { useLessonSession } from '@/hooks/useLessonSession'
import { buildLessonAskContext } from '@/lib/mindmapLesson/askContext'
import type { LessonCamera } from '@/lib/mindmapLesson/types'
import {
  downloadBlob,
  exportLessonVideo,
} from '@/lib/mindmapLesson/exportLessonVideo'

type Props = {
  data: MindMapData
  title?: string
  chapterId?: string
  markdown?: string | null
  defaultCollapsed?: boolean
  pageSources?: PageSource[] | null
  pageText?: string | null
  startPage?: number | null
  endPage?: number | null
  onOpenInPdf?: (page: number, label: string) => void
  onRefreshMap?: () => void
  refreshingMap?: boolean
  /**
   * studio = explore map with table-backed topic detail (Zihin haritası tab)
   * lesson = cinematic DFS tour + EMA (Dinle tab)
   */
  variant?: 'studio' | 'lesson'
  /** True when AI map-locked lesson script is ready (Dinle ready state) */
  lessonScriptReady?: boolean
}

const BRANCH_COLORS_FALLBACK = [
  '#2d4635',
  '#3d6b8a',
  '#a67c52',
  '#3d5c48',
  '#5a6d7c',
  '#6fa98a',
]

function readBranchColors(): string[] {
  if (typeof document === 'undefined') return BRANCH_COLORS_FALLBACK
  const cs = getComputedStyle(document.documentElement)
  const pick = (name: string, fb: string) => {
    const v = cs.getPropertyValue(name).trim()
    return v || fb
  }
  return [
    pick('--accent-mid', BRANCH_COLORS_FALLBACK[0]!),
    pick('--accent', BRANCH_COLORS_FALLBACK[1]!),
    pick('--gold', BRANCH_COLORS_FALLBACK[2]!),
    pick('--accent-deep', BRANCH_COLORS_FALLBACK[3]!),
    pick('--ink-muted', BRANCH_COLORS_FALLBACK[4]!),
    pick('--accent-mid', BRANCH_COLORS_FALLBACK[5]!),
  ]
}

type NodeData = {
  label: string
  kind: 'central' | 'branch' | 'leaf'
  color?: string
  children?: string[]
  page?: number | null
  /** Branch id for expand toggle */
  branchId?: string
  childCount?: number
  isOpen?: boolean
  lessonActive?: boolean
  lessonDone?: boolean
  lessonPath?: boolean
  lessonDim?: boolean
}

function ConceptNode({ data }: NodeProps) {
  const d = data as NodeData
  const kind = String(d.kind || 'branch')
  const label = String(d.label || '')
  const color = String(d.color || '')
  const childCount = Number(d.childCount || 0)
  const isOpen = Boolean(d.isOpen)
  const lessonCls = [
    d.lessonActive ? 'mind-node--lesson-active' : '',
    d.lessonDone && !d.lessonActive ? 'mind-node--lesson-done' : '',
    d.lessonPath && !d.lessonActive ? 'mind-node--lesson-path' : '',
    d.lessonDim && !d.lessonActive && !d.lessonPath
      ? 'mind-node--lesson-dim'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={`mind-node mind-node--${kind}${isOpen ? ' mind-node--open' : ''}${
        childCount > 0 && kind === 'branch' ? ' mind-node--expandable' : ''
      }${lessonCls ? ` ${lessonCls}` : ''}`}
      style={
        kind === 'branch' && color
          ? {
              borderColor: `${color}55`,
              background: `${color}12`,
              color,
            }
          : kind === 'leaf' && color
            ? { borderColor: `${color}28` }
            : undefined
      }
    >
      {d.lessonActive ? (
        <span className="mind-node__spotlight" aria-hidden />
      ) : null}
      {kind !== 'central' && (
        <Handle type="target" position={Position.Left} className="!opacity-0" />
      )}
      <span className="mind-node__label">{label}</span>
      {d.lessonDone && !d.lessonActive ? (
        <span className="mind-node__check" aria-hidden>
          ✓
        </span>
      ) : null}
      {kind === 'branch' && childCount > 0 ? (
        <span className="mind-node__badge" aria-hidden>
          {isOpen ? '−' : `+${childCount}`}
        </span>
      ) : null}
      {kind !== 'leaf' && (
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      )}
    </div>
  )
}

const nodeTypes = { concept: ConceptNode }

type Branch = { label: string; children?: string[]; page?: number | null }

function estimateHeight(label: string, kind: 'central' | 'branch' | 'leaf'): number {
  const charsPerLine = kind === 'leaf' ? 24 : kind === 'branch' ? 22 : 18
  const lines = Math.max(
    1,
    Math.ceil(label.replace(/\s+/g, ' ').trim().length / charsPerLine),
  )
  const lineH = kind === 'central' ? 22 : 17
  const pad = kind === 'leaf' ? 22 : 26
  const maxLines = kind === 'leaf' ? 3 : 2
  return pad + Math.min(lines, maxLines) * lineH
}

function tidyBranches(raw: Branch[]): Branch[] {
  const normalized = normalizeMindMapTopics({
    central: '·',
    branches: raw.map((b) => ({
      label: b.label,
      children: b.children,
      page: b.page,
    })),
  })
  return normalized.branches.map((b) => ({
    label: b.label,
    children: b.children,
    page: b.page ?? null,
  }))
}

/**
 * NotebookLM-style: only expanded branches reveal children.
 * Default view = merkez + ana dallar.
 */
function layoutMindMap(
  data: MindMapData,
  openIds: Set<string>,
): { nodes: Node[]; edges: Edge[]; focusIds: string[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const focusIds: string[] = []
  const branches = tidyBranches(data.branches ?? [])

  const COL = { central: 28, branch: 280, leaf: 520 }
  const BRANCH_GAP = 26
  const LEAF_GAP = 12
  const colors = readBranchColors()
  const centralLabel =
    toTopicLabel(String(data.central || 'Konu'), {
      maxWords: 5,
      maxChars: 36,
    }) || 'Konu'

  const laid = branches.map((b, i) => {
    const bid = `b-${i}`
    const open = openIds.has(bid)
    const kids = open ? (b.children ?? []).slice(0, 8) : []
    const leafHs = kids.map((c) => estimateHeight(c, 'leaf'))
    const leavesH =
      leafHs.reduce((s, h) => s + h, 0) +
      Math.max(0, leafHs.length - 1) * LEAF_GAP
    const branchH = estimateHeight(b.label, 'branch')
    return {
      bid,
      label: b.label,
      h: Math.max(branchH, leavesH || branchH),
      branchH,
      children: kids,
      leafHs,
      page: b.page ?? null,
      allChildren: b.children ?? [],
      open,
      color: colors[i % colors.length]!,
    }
  })

  const totalH =
    laid.reduce((s, b) => s + b.h, 0) + Math.max(0, laid.length - 1) * BRANCH_GAP

  const startY = 16
  const centralH = estimateHeight(centralLabel, 'central')

  nodes.push({
    id: 'central',
    type: 'concept',
    position: {
      x: COL.central,
      y: startY + Math.max(0, totalH / 2 - centralH / 2),
    },
    data: {
      label: centralLabel,
      kind: 'central',
      children: branches.map((b) => b.label),
    } satisfies NodeData,
    draggable: false,
  })

  let cursorY = startY
  laid.forEach((branch) => {
    const branchY = cursorY + Math.max(0, (branch.h - branch.branchH) / 2)

    nodes.push({
      id: branch.bid,
      type: 'concept',
      position: { x: COL.branch, y: branchY },
      data: {
        label: branch.label,
        kind: 'branch',
        color: branch.color,
        children: branch.allChildren,
        page: branch.page,
        branchId: branch.bid,
        childCount: branch.allChildren.length,
        isOpen: branch.open,
      } satisfies NodeData,
      draggable: false,
    })

    edges.push({
      id: `e-c-${branch.bid}`,
      source: 'central',
      target: branch.bid,
      type: 'smoothstep',
      animated: branch.open,
      style: {
        stroke: branch.color,
        strokeWidth: branch.open ? 2.4 : 1.7,
        opacity: branch.open ? 0.95 : 0.55,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: branch.color,
      },
    })

    if (branch.open) {
      focusIds.push(branch.bid)
      let leafY = cursorY
      branch.children.forEach((child, j) => {
        const lid = `${branch.bid}-l-${j}`
        const lh = branch.leafHs[j] ?? estimateHeight(child, 'leaf')
        nodes.push({
          id: lid,
          type: 'concept',
          position: { x: COL.leaf, y: leafY },
          data: {
            label: child,
            kind: 'leaf',
            color: branch.color,
            page: branch.page,
            branchId: branch.bid,
          } satisfies NodeData,
          draggable: false,
        })
        edges.push({
          id: `e-${branch.bid}-${j}`,
          source: branch.bid,
          target: lid,
          type: 'smoothstep',
          animated: true,
          style: {
            stroke: branch.color,
            strokeWidth: 1.45,
            opacity: 0.72,
          },
        })
        focusIds.push(lid)
        leafY += lh + LEAF_GAP
      })
    }

    cursorY += branch.h + BRANCH_GAP
  })

  return { nodes, edges, focusIds }
}

const KIND_LABEL: Record<string, string> = {
  central: 'Merkez',
  branch: 'Ana başlık',
  leaf: 'Alt başlık',
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse), (max-width: 767px)')
    const apply = () => setCoarse(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return coarse
}

function fitCalm(
  rf: ReactFlowInstance | null,
  opts?: { animate?: boolean; coarse?: boolean; nodeIds?: string[] },
) {
  if (!rf) return
  const animate = opts?.animate ?? false
  const coarse = opts?.coarse ?? false
  const nodeIds = opts?.nodeIds
  void rf.fitView({
    ...(nodeIds?.length ? { nodes: nodeIds.map((id) => ({ id })) } : {}),
    padding: nodeIds?.length ? (coarse ? 0.28 : 0.22) : coarse ? 0.1 : 0.08,
    includeHiddenNodes: false,
    minZoom: nodeIds?.length ? 0.7 : 0.55,
    maxZoom: nodeIds?.length ? 1.35 : 1.2,
    duration: animate ? 320 : 0,
  })
}

/** Interactive topic map — expand children on click + zoom (NotebookLM-style). */
export default function MindMapPanel({
  data,
  title,
  chapterId,
  markdown,
  defaultCollapsed = false,
  pageSources = null,
  pageText = null,
  startPage = null,
  endPage = null,
  onOpenInPdf,
  onRefreshMap,
  refreshingMap = false,
  variant = 'studio',
  lessonScriptReady = false,
}: Props) {
  const lessonMode = variant === 'lesson'
  const branches = useMemo(
    () => tidyBranches(data.branches ?? []),
    [data.branches],
  )
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const [detail, setDetail] = useState<MindMapTopicDetail | null>(null)
  const [pdfHit, setPdfHit] = useState<MindMapPdfHit | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const pendingFocusRef = useRef<string[] | null>(null)
  const lessonManualPanRef = useRef(false)
  const cameraFlyingRef = useRef(false)
  const viewportTickRef = useRef(0)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportLabel, setExportLabel] = useState('')
  const [exportFocus, setExportFocus] = useState<{
    nodeId: string
    camera: LessonCamera
    completed: Set<string>
  } | null>(null)
  const [exportCaption, setExportCaption] = useState<{
    title: string
    words: string[]
    highlight: number
  } | null>(null)
  const [viewportEpoch, setViewportEpoch] = useState(0)
  const [rfReady, setRfReady] = useState(0)
  const coarse = useCoarsePointer()
  const branchColors = useMemo(() => readBranchColors(), [data.central, data.branches])

  const lesson = useLessonSession({ data, markdown, title, chapterId })
  const lessonAsking = lessonMode && lesson.phase === 'asking'
  const lessonActive = Boolean(
    lessonMode &&
      lesson.phase !== 'idle' &&
      lesson.phase !== 'error',
  )
  /** Lesson map framing + bubble during live play or video export */
  const lessonVisual = lessonActive || (lessonMode && exportBusy)
  const askContext = useMemo(
    () =>
      buildLessonAskContext(
        lesson.timeline,
        lesson.playerState?.segmentIndex ?? 0,
        markdown,
      ),
    [lesson.timeline, lesson.playerState?.segmentIndex, markdown],
  )
  const focusNodeId = exportFocus?.nodeId ?? lesson.activeNodeId
  const focusCamera = exportFocus?.camera ?? lesson.activeCamera
  const focusCompleted = exportFocus?.completed ?? lesson.completedIds
  const pathIds = useMemo(
    () => lessonPathIds(focusNodeId),
    [focusNodeId],
  )

  const lessonSeg =
    lesson.timeline?.segments[lesson.playerState?.segmentIndex ?? 0] ?? null
  const lessonCaption = useMemo(() => {
    const seg = lessonSeg
    if (!seg) return { title: '', words: [] as string[], highlight: -1 }
    const t = lesson.playerState?.currentTime ?? 0
    const segWords = (lesson.timeline?.words ?? []).filter(
      (w) => w.segmentId === seg.id,
    )
    let localWord = -1
    for (let i = 0; i < segWords.length; i++) {
      if (segWords[i]!.s <= t) localWord = i
      else break
    }
    const words = segWords.length
      ? segWords.map((w) => w.w)
      : seg.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    const highlight = segWords.length
      ? localWord
      : lesson.activeWordIndex
    return {
      title: seg.title || '',
      words,
      highlight,
    }
  }, [
    lessonSeg,
    lesson.timeline?.words,
    // Only recompute when the spoken word changes — not every clock tick
    lesson.playerState?.wordIndex,
    lesson.activeWordIndex,
  ])

  const displayCaption = exportCaption ?? lessonCaption

  const showSpeechBubble =
    lessonMode &&
    Boolean(focusNodeId) &&
    Boolean(displayCaption.words.length) &&
    (exportBusy ||
      lesson.phase === 'playing' ||
      lesson.phase === 'paused' ||
      lesson.phase === 'ready' ||
      lesson.phase === 'done' ||
      (lesson.phase === 'synthesizing' &&
        Boolean(lesson.playerState?.playing || lesson.playerState?.currentTime)))

  // During lesson: keep FULL tree open so the map never disappears
  const effectiveOpenIds = useMemo(() => {
    if (!lessonVisual) return openIds
    return lessonOpenAllBranches(branches.length)
  }, [openIds, lessonVisual, branches.length])

  const { nodes: rawNodes, edges: rawEdges, focusIds } = useMemo(
    () => layoutMindMap(data, effectiveOpenIds),
    [data, effectiveOpenIds],
  )

  const nodes = useMemo(() => {
    if (!lessonVisual) return rawNodes
    const hasFocus = Boolean(focusNodeId)
    const hubShot =
      !hasFocus || focusCamera === 'hub' || focusNodeId === 'central'
    return rawNodes.map((n) => {
      const active = focusNodeId === n.id
      const onPath = pathIds.has(n.id)
      const done = !active && focusCompleted.has(n.id)
      const dim =
        hasFocus &&
        !hubShot &&
        !active &&
        !onPath &&
        n.id !== 'central'
      return {
        ...n,
        data: {
          ...(n.data as NodeData),
          lessonActive: active,
          lessonDone: done,
          lessonPath: onPath,
          lessonDim: dim,
        },
        className: active
          ? 'mind-flow-node--active'
          : done
            ? 'mind-flow-node--done'
            : dim
              ? 'mind-flow-node--dim'
              : onPath
                ? 'mind-flow-node--path'
                : undefined,
      }
    })
  }, [
    rawNodes,
    lessonVisual,
    focusNodeId,
    focusCamera,
    focusCompleted,
    pathIds,
  ])

  const edges = useMemo(() => {
    if (!lessonVisual) return rawEdges
    return rawEdges.map((e) => {
      const hot = lessonEdgeHighlight(e.id, focusNodeId)
      return {
        ...e,
        animated: hot || Boolean(e.animated),
        style: {
          ...e.style,
          strokeWidth: hot
            ? Math.max(
                2.8,
                Number(
                  (e.style as { strokeWidth?: number })?.strokeWidth || 1.7,
                ),
              )
            : Number((e.style as { strokeWidth?: number })?.strokeWidth || 1.6),
          opacity: hot
            ? 1
            : Math.max(
                0.28,
                Number((e.style as { opacity?: number })?.opacity ?? 0.55) * 0.55,
              ),
        },
      }
    })
  }, [rawEdges, lessonVisual, focusNodeId])

  const topicCount = useMemo(() => {
    let n = 1 + branches.length
    for (const b of branches) n += b.children?.length ?? 0
    return n
  }, [branches])

  const openCount = openIds.size
  const childCountOpen = useMemo(() => {
    let n = 0
    openIds.forEach((id) => {
      const i = Number(id.replace('b-', ''))
      if (Number.isFinite(i) && branches[i]) n += branches[i]!.children?.length ?? 0
    })
    return n
  }, [openIds, branches])

  const canLocatePdf = Boolean(onOpenInPdf)

  const findPdfHit = useCallback(
    (label: string, page?: number | null) => {
      if (!canLocatePdf) return null
      return locateMindMapInPdf({
        label,
        page,
        pageSources,
        pageText,
        startPage,
        endPage,
      })
    },
    [canLocatePdf, pageSources, pageText, startPage, endPage],
  )

  const scheduleFit = useCallback(
    (animate = false, nodeIds?: string[]) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          fitCalm(rfRef.current, { animate, coarse, nodeIds })
        })
      })
    },
    [coarse],
  )

  // Reset drill-down when map data regenerates
  useEffect(() => {
    setOpenIds(new Set())
    setDetail(null)
    setPdfHit(null)
    pendingFocusRef.current = null
  }, [data.central, data.branches])

  useEffect(() => {
    if (collapsed || lessonActive) return
    const focus = pendingFocusRef.current
    if (focus?.length) {
      pendingFocusRef.current = null
      scheduleFit(true, focus)
      return
    }
    if (openIds.size === 0) scheduleFit(false)
  }, [
    collapsed,
    lessonActive,
    nodes,
    edges,
    expanded,
    openIds,
    scheduleFit,
    focusIds,
  ])

  useEffect(() => {
    if (collapsed || !canvasRef.current || lessonActive) return
    const el = canvasRef.current
    const ro = new ResizeObserver(() => {
      if (openIds.size > 0 && focusIds.length) scheduleFit(false, focusIds)
      else scheduleFit(false)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed, expanded, scheduleFit, openIds, focusIds, lessonActive])

  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  useEffect(() => {
    if (!detail || expanded || coarse) return
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [detail, expanded, coarse])

  // Every new spoken node: force-fly the camera there (even if user panned away)
  useEffect(() => {
    if (!lessonActive || !focusNodeId || lessonAsking) return

    const id = focusNodeId
    const camera = focusCamera
    const allBranchIds = branches.map((_, i) => `b-${i}`)
    const frameIds = lessonFrameIds(id, camera, {
      allBranchIds,
      childIdsForBranch: (bid) => {
        const i = Number(bid.replace('b-', ''))
        const kids = branches[i]?.children ?? []
        return kids.map((_, j) => `${bid}-l-${j}`)
      },
    })

    // Reclaim camera on node change — manual pan only lasts until the next beat
    lessonManualPanRef.current = false
    if (!lesson.followCamera) lesson.setFollowCamera(true)

    let cancelled = false
    let cancelFly: (() => void) | null = null
    const timers: number[] = []

    const fly = () => {
      if (cancelled || !rfRef.current) return
      cancelFly?.()
      cameraFlyingRef.current = true
      cancelFly = fitLessonFrame(rfRef.current, {
        camera,
        nodeIds: frameIds,
        focusId: id,
        coarse,
      })
      timers.push(
        window.setTimeout(() => {
          cameraFlyingRef.current = false
        }, 900),
      )
      for (const ms of [180, 450, 800]) {
        timers.push(
          window.setTimeout(() => {
            if (!cancelled) setViewportEpoch((n) => n + 1)
          }, ms),
        )
      }
    }

    timers.push(window.setTimeout(fly, 50))

    return () => {
      cancelled = true
      cameraFlyingRef.current = false
      cancelFly?.()
      for (const t of timers) window.clearTimeout(t)
    }
    // Node/camera change only — map layout length must not retrigger (flicker)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- followCamera reclaimed inside
  }, [
    lessonActive,
    lessonAsking,
    focusNodeId,
    focusCamera,
    exportFocus,
    branches,
    coarse,
  ])

  const openDetail = useCallback(
    (d: NodeData) => {
      stopSpeech()
      setSpeaking(false)
      setDetail(
        buildMindMapTopicDetail({
          label: d.label,
          kind: d.kind || 'branch',
          children: d.children,
          markdown,
          unitTitle: title,
        }),
      )
      setPdfHit(findPdfHit(d.label, d.page))
    },
    [markdown, title, findPdfHit],
  )

  const toggleBranch = useCallback(
    (branchId: string, d: NodeData) => {
      setOpenIds((prev) => {
        const next = new Set<string>()
        // Accordion: one branch open at a time keeps the map readable
        if (!prev.has(branchId)) next.add(branchId)
        const willOpen = next.has(branchId)
        if (willOpen) {
          const kids = (d.children ?? []).slice(0, 6)
          pendingFocusRef.current = [
            branchId,
            ...kids.map((_, j) => `${branchId}-l-${j}`),
          ]
        } else {
          pendingFocusRef.current = ['central', ...branches.map((_, i) => `b-${i}`)]
        }
        return next
      })
      openDetail(d)
    },
    [branches, openDetail],
  )

  const seekLessonNode = lesson.seekNode
  const lessonHasAudio = Boolean(lesson.timeline?.segments.length)

  const exportVideo = useCallback(async () => {
    const tl = lesson.timeline
    const mapEl = canvasRef.current
    if (!mapEl) {
      setExportLabel('Harita alanı bulunamadı')
      return
    }
    if (!tl?.segments.length) {
      setExportLabel('Önce Dersi Başlat — ses hazır olunca indir')
      return
    }
    // Pause lesson playback so it doesn't fight the export mix
    if (lesson.phase === 'playing') {
      await lesson.toggle()
    }
    // Warm AudioContext under this user gesture
    try {
      const warm = new AudioContext()
      await warm.resume()
      await warm.close()
    } catch {
      /* ignore */
    }

    setExportBusy(true)
    setExportLabel('Video kaydı başlıyor…')
    lessonManualPanRef.current = false
    lesson.setFollowCamera(true)
    const completed = new Set<string>()

    const wordsForSeg = (segId: string, text: string) => {
      const timed = (tl.words ?? []).filter((w) => w.segmentId === segId)
      if (timed.length) return timed.map((w) => w.w)
      return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    }

    try {
      const blob = await exportLessonVideo({
        mapEl,
        timeline: tl,
        onProgress: (p) => {
          setExportLabel(p.label)
        },
        onSegment: async (i, nodeId) => {
          const seg = tl.segments[i]!
          for (let j = 0; j < i; j++) {
            const prev = tl.segments[j]!
            if (prev.nodeId !== nodeId) completed.add(prev.nodeId)
          }
          const words = wordsForSeg(seg.id, seg.text)
          setExportCaption({
            title: seg.title || '',
            words,
            highlight: words.length ? 0 : -1,
          })
          setExportFocus({
            nodeId,
            camera: seg.camera,
            completed: new Set(completed),
          })
          const frameIds = lessonFrameIds(nodeId, seg.camera, {
            allBranchIds: branches.map((_, bi) => `b-${bi}`),
            childIdsForBranch: (bid) => {
              const bi = Number(bid.replace('b-', ''))
              const kids = branches[bi]?.children ?? []
              return kids.map((_, j) => `${bid}-l-${j}`)
            },
          })
          fitLessonFrame(rfRef.current, {
            camera: seg.camera,
            nodeIds: frameIds,
            focusId: nodeId,
            coarse,
          })
          // Nudge bubble reposition after the fly starts
          for (const ms of [200, 500, 900]) {
            window.setTimeout(() => {
              setViewportEpoch((n) => n + 1)
            }, ms)
          }
          await new Promise((r) => setTimeout(r, 120))
        },
        onCaptionTick: async (i, wordIndex) => {
          const seg = tl.segments[i]
          if (!seg) return
          const words = wordsForSeg(seg.id, seg.text)
          setExportCaption({
            title: seg.title || '',
            words,
            highlight: wordIndex,
          })
          setViewportEpoch((n) => n + 1)
        },
      })
      const name = `${(title || data.central || 'ders')
        .replace(/[^\w\u00C0-\u024f\s-]+/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40) || 'ders'}-harita.webm`
      downloadBlob(blob, name)
      setExportLabel('Video indirildi')
    } catch (err) {
      console.error('[lesson video]', err)
      setExportLabel(
        err instanceof Error ? err.message : 'Video oluşturulamadı',
      )
    } finally {
      setExportFocus(null)
      setExportCaption(null)
      setExportBusy(false)
    }
  }, [lesson, title, data.central, branches, coarse])

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_ev, node) => {
      const d = node.data as NodeData
      if (lessonActive && lessonHasAudio) {
        if (lesson.phase === 'asking') return
        void seekLessonNode(node.id)
        openDetail(d)
        return
      }
      if (d.kind === 'branch' && (d.childCount ?? 0) > 0 && d.branchId) {
        toggleBranch(d.branchId, d)
        return
      }
      if (d.kind === 'central') {
        setOpenIds(new Set())
        pendingFocusRef.current = [
          'central',
          ...branches.map((_, i) => `b-${i}`),
        ]
        openDetail(d)
        return
      }
      openDetail(d)
    },
    [
      toggleBranch,
      openDetail,
      branches,
      lessonActive,
      lessonHasAudio,
      seekLessonNode,
      lesson.phase,
    ],
  )

  function speakDetail() {
    if (!detail || !isTtsSupported()) return
    speakText(detail.speech, {
      rate: getStoredRate(),
      voiceUri: getStoredVoiceUri(),
      lang: getStoredLang(),
      onStatus: (s) => setSpeaking(s === 'speaking' || s === 'paused'),
      onEnd: () => setSpeaking(false),
    })
  }

  function closeDetail() {
    stopSpeech()
    setSpeaking(false)
    setDetail(null)
    setPdfHit(null)
  }

  function openInPdf() {
    if (!detail || !pdfHit || !onOpenInPdf) return
    onOpenInPdf(pdfHit.page, detail.title)
  }

  function resetOverview() {
    setOpenIds(new Set())
    pendingFocusRef.current = [
      'central',
      ...branches.map((_, i) => `b-${i}`),
    ]
    scheduleFit(true)
  }

  if (!branches.length) return null

  const canvas = (
    <div
      ref={canvasRef}
      className={`mind-map-canvas${expanded ? ' mind-map-canvas--expanded' : ''}${
        lessonVisual ? ' mind-map-canvas--lesson' : ''
      }${exportBusy ? ' mind-map-canvas--exporting' : ''}`}
    >
      <div className="mind-map-canvas__aurora" aria-hidden />
      <div className="mind-map-canvas__grid" aria-hidden />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          rfRef.current = instance
          setRfReady((n) => n + 1)
          scheduleFit(false)
        }}
        minZoom={0.35}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={!coarse}
        zoomOnScroll={!coarse}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag
        preventScrolling
        onNodeClick={onNodeClick}
        onMoveStart={(event) => {
          // Ignore programmatic camera flies (null event OR our own setCenter).
          // User pan only pauses until the *next* spoken node (effect reclaims).
          if (!lessonActive || event == null || cameraFlyingRef.current) return
          if (lessonManualPanRef.current) return
          lessonManualPanRef.current = true
          lesson.setFollowCamera(false)
        }}
        onMove={() => {
          if (!lessonActive) return
          // Skip thrash during programmatic camera fly — timers sync the bubble
          if (cameraFlyingRef.current) return
          if (viewportTickRef.current) return
          viewportTickRef.current = window.requestAnimationFrame(() => {
            viewportTickRef.current = 0
            setViewportEpoch((n) => n + 1)
          })
        }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        attributionPosition="bottom-left"
      >
        <Background
          id="mind-dots"
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.15}
          color={`${branchColors[0] || '#3d5c48'}44`}
        />
        <Background
          id="mind-lines"
          variant={BackgroundVariant.Lines}
          gap={88}
          size={1}
          color={`${branchColors[0] || '#3d5c48'}22`}
        />
        {!lessonActive ? (
          <>
            <MiniMap
              className="mind-map-minimap"
              pannable
              zoomable
              nodeStrokeWidth={2}
              maskColor="rgba(18, 24, 32, 0.18)"
              nodeColor={(n) => {
                const d = n.data as NodeData
                if (d.kind === 'central')
                  return branchColors[3] || branchColors[0] || '#243a2c'
                return String(d.color || branchColors[0] || '#3d5c48')
              }}
            />
            <Controls showInteractive={false} showFitView={false} />
          </>
        ) : null}
      </ReactFlow>
      {lessonVisual ? (
        <div className="mind-map-canvas__vignette" aria-hidden />
      ) : null}
      <LessonSpeechBubble
        key={rfReady}
        rf={rfRef.current}
        canvasEl={canvasRef.current}
        nodeId={focusNodeId}
        title={displayCaption.title}
        words={displayCaption.words}
        highlight={displayCaption.highlight}
        viewportEpoch={viewportEpoch}
        visible={showSpeechBubble}
      />
      {!lessonActive ? (
        <div className="mind-map-hud" aria-hidden>
          <span>{topicCount} düğüm</span>
          <span>·</span>
          <span>{branches.length} dal</span>
          {openCount > 0 ? (
            <>
              <span>·</span>
              <span className="mind-map-hud__live">
                {openCount} açık · {childCountOpen} alt
              </span>
            </>
          ) : (
            <>
              <span>·</span>
              <span>genel bakış</span>
            </>
          )}
        </div>
      ) : null}
    </div>
  )

  const detailCard = detail ? (
    <aside
      ref={detailRef}
      className={`mind-map-detail mind-map-detail--glass ${
        coarse ? 'mind-map-detail--sheet' : 'mind-map-detail--dock'
      }`}
      aria-live="polite"
    >
      {coarse ? <div className="mind-map-detail__grab" aria-hidden /> : null}
      <div className="mind-map-detail__top">
        <div>
          <p className="mind-map-detail__kind">
            {KIND_LABEL[detail.kind] || 'Konu'}
          </p>
          <h3 className="mind-map-detail__title">{detail.title}</h3>
        </div>
        <div className="mind-map-detail__actions">
          {isTtsSupported() ? (
            speaking ? (
              <>
                <LessonWaitMood
                  kind="speaking"
                  size="compact"
                  className="mind-map-detail__wait"
                  title="Konu okunuyor"
                />
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    stopSpeech()
                    setSpeaking(false)
                  }}
                >
                  Durdur
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary !px-3 !py-1.5 text-xs"
                onClick={speakDetail}
              >
                Sesli oku
              </button>
            )
          ) : null}
          <button type="button" className="btn-ghost text-xs" onClick={closeDetail}>
            Kapat
          </button>
        </div>
      </div>

      {pdfHit && onOpenInPdf ? (
        <button
          type="button"
          className="mind-map-detail__pdf"
          onClick={openInPdf}
        >
          PDF’de aç · s. {pdfHit.page}
        </button>
      ) : canLocatePdf ? (
        <p className="mind-map-detail__pdf-miss muted text-xs">
          Bu düğüm için PDF sayfası bulunamadı
        </p>
      ) : null}

      <div className="mind-map-detail__body">
        <StudyMarkdown markdown={detail.narrative} compact />
      </div>

      {detail.points.length > 0 && (
        <div className="mind-map-detail__points">
          <p className="mind-map-detail__points-label">Alt başlıklar</p>
          <ul>
            {detail.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  ) : null

  const panel = (
    <div
      className={`mind-map-panel mind-map-panel--spectacle ${
        expanded ? 'mind-map-panel--expanded' : ''
      }${detail && !coarse ? ' mind-map-panel--with-detail' : ''}${
        lessonMode ? ' mind-map-panel--lesson-live mind-map-panel--lesson' : ''
      }`}
    >
      {!lessonMode ? (
        <div className="mind-map-panel__head">
          <div>
            <p className="mind-map-panel__kicker">Konu ağı</p>
            <h2 className="mind-map-panel__title">
              {title?.trim() || String(data.central || 'Zihin haritası')}
            </h2>
            {!collapsed ? (
              <p className="mind-map-panel__sub">
                {coarse
                  ? 'Düğüme dokun — alt başlıklar açılır, PDF’ye sıçra'
                  : 'Dalı genişlet · scroll ile zoom · detay paneli sağda'}
              </p>
            ) : null}
          </div>
          <div className="mind-map-panel__tools">
            {onRefreshMap ? (
              <button
                type="button"
                className="mind-map-tool"
                disabled={refreshingMap}
                onClick={() => onRefreshMap()}
              >
                {refreshingMap ? 'Yenileniyor…' : 'Yenile'}
              </button>
            ) : null}
            <button
              type="button"
              className="mind-map-tool"
              onClick={() => {
                const next = !collapsed
                setCollapsed(next)
                if (!next) scheduleFit(false)
              }}
            >
              {collapsed ? 'Göster' : 'Gizle'}
            </button>
            {!collapsed ? (
              <>
                <button
                  type="button"
                  className="mind-map-tool"
                  onClick={resetOverview}
                >
                  Genel bakış
                </button>
                <button
                  type="button"
                  className="mind-map-tool mind-map-tool--accent"
                  onClick={() => {
                    setExpanded((v) => !v)
                  }}
                >
                  {expanded ? 'Küçült' : 'Tam sahne'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {collapsed ? null : (
        <>
          {!lessonMode ? (
          <div className="mind-map-jumps" role="list">
            <button
              type="button"
              className="mind-map-jump mind-map-jump--hub"
              role="listitem"
              onClick={() => {
                setOpenIds(new Set())
                pendingFocusRef.current = [
                  'central',
                  ...branches.map((_, i) => `b-${i}`),
                ]
                openDetail({
                  label: String(data.central || title || 'Konu'),
                  kind: 'central',
                  children: branches.map((b) => b.label),
                })
              }}
            >
              Merkez
            </button>
            {branches.map((b, i) => {
              const bid = `b-${i}`
              const isOpen = openIds.has(bid)
              const color = branchColors[i % branchColors.length]!
              return (
                <button
                  key={`${b.label}-${i}`}
                  type="button"
                  className={`mind-map-jump${isOpen ? ' mind-map-jump--active' : ''}`}
                  role="listitem"
                  style={{
                    borderColor: `${color}66`,
                    ['--jump-glow' as string]: color,
                  }}
                  onClick={() =>
                    toggleBranch(bid, {
                      label: b.label,
                      kind: 'branch',
                      children: b.children,
                      color,
                      page: b.page,
                      branchId: bid,
                      childCount: b.children?.length ?? 0,
                    })
                  }
                >
                  <span
                    className="mind-map-legend__dot"
                    style={{ background: color }}
                  />
                  {b.label.length > 28 ? `${b.label.slice(0, 26)}…` : b.label}
                </button>
              )
            })}
          </div>
          ) : null}

          <div
            className={`mind-map-stage${lessonMode ? ' mind-map-stage--lesson' : ''}${
              lessonAsking ? ' mind-map-stage--asking' : ''
            }`}
          >
            {canvas}
            {detail && !coarse && !lessonActive ? (
              <div className="mind-map-stage__detail">{detailCard}</div>
            ) : null}
            {lessonMode &&
            (lesson.phase === 'loading_model' ||
              lesson.phase === 'synthesizing') &&
            !(lesson.playerState?.playing) ? (
              <div className="mind-map-stage__wait" aria-hidden={false}>
                <LessonWaitMood
                  kind="audio"
                  size="stage"
                  detail={lesson.progressLabel || null}
                />
              </div>
            ) : null}
            {lessonMode && chapterId ? (
              <LessonAskPanel
                open={lessonAsking}
                chapterId={chapterId}
                chapterTitle={title || data.central || 'Ünite'}
                context={askContext}
                onResume={() => {
                  stopSpeech()
                  setSpeaking(false)
                  lessonManualPanRef.current = false
                  void lesson.resumeFromAsk()
                }}
              />
            ) : null}
          </div>

          {lessonMode ? (
            <LessonPlayer
              phase={lesson.phase}
              error={lesson.error}
              progressLabel={lesson.progressLabel}
              progressPct={lesson.progressPct}
              timeline={lesson.timeline}
              currentTime={lesson.playerState?.currentTime ?? 0}
              segmentIndex={lesson.playerState?.segmentIndex ?? 0}
              wordIndex={lesson.activeWordIndex}
              rate={lesson.playerState?.rate ?? 1}
              followCamera={lesson.followCamera}
              captionOnMap={showSpeechBubble && !lessonAsking}
              buffering={Boolean(lesson.playerState?.buffering)}
              bufferingLong={Boolean(lesson.playerState?.bufferingLong)}
              scriptReady={lessonScriptReady}
              canAsk={Boolean(chapterId) && Boolean(askContext)}
              onAsk={() => {
                stopSpeech()
                setSpeaking(false)
                lesson.pauseForAsk()
              }}
              onResumeAsk={() => {
                stopSpeech()
                setSpeaking(false)
                lessonManualPanRef.current = false
                void lesson.resumeFromAsk()
              }}
              onStart={() => {
                stopSpeech()
                setSpeaking(false)
                lessonManualPanRef.current = false
                void lesson.start()
              }}
              onToggle={() => void lesson.toggle()}
              onPrev={lesson.prev}
              onNext={lesson.next}
              onSeekSegment={lesson.seekSegment}
              onSetRate={lesson.setRate}
              onRestart={() => {
                lessonManualPanRef.current = false
                void lesson.restart()
              }}
              onFollowCamera={() => {
                lessonManualPanRef.current = false
                lesson.setFollowCamera(true)
                if (focusNodeId) {
                  const frameIds = lessonFrameIds(focusNodeId, focusCamera, {
                    allBranchIds: branches.map((_, i) => `b-${i}`),
                    childIdsForBranch: (bid) => {
                      const i = Number(bid.replace('b-', ''))
                      const kids = branches[i]?.children ?? []
                      return kids.map((_, j) => `${bid}-l-${j}`)
                    },
                  })
                  fitLessonFrame(rfRef.current, {
                    camera: focusCamera,
                    nodeIds: frameIds,
                    focusId: focusNodeId,
                    coarse,
                  })
                }
              }}
              onExportVideo={() => void exportVideo()}
              exportBusy={exportBusy}
              exportLabel={exportLabel}
            />
          ) : null}

          {detail && coarse
            ? createPortal(
                <div
                  className="mind-map-sheet-backdrop"
                  onClick={closeDetail}
                  role="presentation"
                >
                  <div onClick={(e) => e.stopPropagation()} role="presentation">
                    {detailCard}
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      )}
    </div>
  )

  if (expanded) {
    return createPortal(
      <div className="mind-map-overlay" role="dialog" aria-modal="true">
        {panel}
      </div>,
      document.body,
    )
  }

  return panel
}

/** Build a simple map when AI mind_map is missing but key_concepts exist. */
export function mindMapFromConcepts(
  title: string,
  concepts: string[],
): MindMapData | null {
  const clean = concepts.map((c) => c.trim()).filter(Boolean).slice(0, 6)
  if (clean.length < 2) return null
  return {
    central: title.slice(0, 72) || 'Konu',
    branches: clean.map((label) => ({ label, children: [] })),
  }
}
