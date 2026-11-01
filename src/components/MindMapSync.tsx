/**
 * Lesson visual helpers — cinematic framing + map readability.
 */
import type { LessonCamera } from '@/lib/mindmapLesson/types'
import type { ReactFlowInstance } from '@xyflow/react'

/** During lesson show the whole tree (all branches expanded). */
export function lessonOpenAllBranches(branchCount: number): Set<string> {
  const next = new Set<string>()
  for (let i = 0; i < branchCount; i++) next.add(`b-${i}`)
  return next
}

export function lessonPathIds(activeNodeId: string | null): Set<string> {
  const path = new Set<string>()
  if (!activeNodeId) return path
  path.add('central')
  if (activeNodeId === 'central') return path
  if (activeNodeId.includes('-l-')) {
    const bid = activeNodeId.replace(/-l-\d+$/, '')
    path.add(bid)
    path.add(activeNodeId)
  } else if (/^b-\d+$/.test(activeNodeId)) {
    path.add(activeNodeId)
  }
  return path
}

/**
 * Nodes that should stay near the spoken node (orientation context).
 */
export function lessonFrameIds(
  activeNodeId: string | null,
  camera: LessonCamera,
  opts?: {
    childIdsForBranch?: (branchId: string) => string[]
    allBranchIds?: string[]
  },
): string[] {
  const branches = opts?.allBranchIds ?? []
  const hub = ['central', ...branches]
  if (!activeNodeId || camera === 'hub' || activeNodeId === 'central') {
    return hub
  }
  const bid = activeNodeId.includes('-l-')
    ? activeNodeId.replace(/-l-\d+$/, '')
    : activeNodeId
  const kids = opts?.childIdsForBranch?.(bid) ?? []

  if (camera === 'leaf' && activeNodeId.includes('-l-')) {
    const idx = Number(activeNodeId.match(/-l-(\d+)$/)?.[1] ?? 0)
    const radius = kids.length > 6 ? 1 : 2
    const near = kids.filter((_, j) => Math.abs(j - idx) <= radius)
    return [...new Set([bid, activeNodeId, ...near])]
  }

  if (kids.length > 8) {
    return [bid, ...kids.slice(0, 6)]
  }
  return [bid, ...kids]
}

export function lessonEdgeHighlight(
  edgeId: string,
  activeNodeId: string | null,
): boolean {
  if (!activeNodeId || activeNodeId === 'central') return false
  if (/^b-\d+$/.test(activeNodeId)) {
    return edgeId === `e-c-${activeNodeId}`
  }
  const m = activeNodeId.match(/^(b-\d+)-l-(\d+)$/)
  if (!m) return false
  return edgeId === `e-c-${m[1]}` || edgeId === `e-${m[1]}-${m[2]}`
}

function targetZoom(camera: LessonCamera, coarse?: boolean): number {
  if (camera === 'leaf') return coarse ? 1.15 : 1.32
  if (camera === 'branch') return coarse ? 0.92 : 1.05
  return coarse ? 0.7 : 0.78
}

/**
 * Always fly the viewport to the spoken node (works even after the user
 * panned elsewhere). Keeps enough zoom-out that the map still reads.
 * Returns a cancel fn for deferred retries.
 */
export function fitLessonFrame(
  rf: ReactFlowInstance | null,
  opts: {
    camera: LessonCamera
    nodeIds: string[]
    focusId?: string | null
    coarse?: boolean
  },
): () => void {
  const noop = () => {}
  if (!rf) return noop

  const focusId =
    opts.focusId && rf.getNode(opts.focusId) ? opts.focusId : null
  const focus = focusId ? rf.getNode(focusId) : null
  const zoom = targetZoom(opts.camera, opts.coarse)
  const duration = 700

  // Hub / no focus → overview of the provided frame
  if (opts.camera === 'hub' || !focus) {
    const present = opts.nodeIds.filter((id) => rf.getNode(id))
    const fitIds = present.length
      ? present
      : rf.getNodes().map((n) => n.id)
    if (!fitIds.length) return noop
    void rf.fitView({
      nodes: fitIds.map((id) => ({ id })),
      padding: opts.coarse ? 0.2 : 0.15,
      includeHiddenNodes: false,
      minZoom: 0.32,
      maxZoom: 0.82,
      duration,
    })
    return noop
  }

  // Direct fly-to the spoken node — reliable after user pan
  const w = focus.measured?.width ?? 160
  const h = focus.measured?.height ?? 48
  const cx = focus.position.x + w / 2
  const cy = focus.position.y + h / 2
  // Shift center right in flow-space ≈ node sits left-of-screen for bubble
  const shiftX = (opts.coarse ? 70 : 100) / zoom

  void rf.setCenter(cx + shiftX, cy, { zoom, duration })

  // Retry once if layout hadn't measured the node yet
  const retry = window.setTimeout(() => {
    const n = focusId ? rf.getNode(focusId) : null
    if (!n) return
    const nw = n.measured?.width ?? w
    const nh = n.measured?.height ?? h
    void rf.setCenter(n.position.x + nw / 2 + shiftX, n.position.y + nh / 2, {
      zoom,
      duration: 450,
    })
  }, 280)

  return () => window.clearTimeout(retry)
}

export function lessonOpenIdsForNode(
  nodeId: string | null,
  _completedIds?: Set<string>,
  branchCount = 0,
): Set<string> {
  if (branchCount > 0) return lessonOpenAllBranches(branchCount)
  const next = new Set<string>()
  if (!nodeId || nodeId === 'central') return next
  if (nodeId.includes('-l-')) next.add(nodeId.replace(/-l-\d+$/, ''))
  else if (/^b-\d+$/.test(nodeId)) next.add(nodeId)
  return next
}
