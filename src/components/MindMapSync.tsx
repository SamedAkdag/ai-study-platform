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

/** Tight cinematic zooms — tree fills the stage, not empty paper. */
function frameMaxZoom(camera: LessonCamera, coarse?: boolean): number {
  if (camera === 'leaf') return coarse ? 1.55 : 1.85
  if (camera === 'branch') return coarse ? 1.22 : 1.42
  return coarse ? 0.92 : 1.05
}

function framePadding(camera: LessonCamera, coarse?: boolean): number {
  // Extra pad on leaf/branch so the reading bubble still fits beside the node
  if (camera === 'leaf') return coarse ? 0.26 : 0.2
  if (camera === 'branch') return coarse ? 0.18 : 0.14
  return coarse ? 0.12 : 0.08
}

/**
 * Always fly the viewport so framed tree nodes fill the stage.
 * Leaves room on the right for the speech bubble when zoomed in.
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
  const maxZoom = frameMaxZoom(opts.camera, opts.coarse)
  const padding = framePadding(opts.camera, opts.coarse)
  const duration = 700

  const present = opts.nodeIds.filter((id) => rf.getNode(id))
  const fitIds = present.length
    ? present
    : focusId
      ? [focusId]
      : rf.getNodes().map((n) => n.id)
  if (!fitIds.length) return noop

  // Fit the spoken cluster so it occupies most of the viewport
  void rf.fitView({
    nodes: fitIds.map((id) => ({ id })),
    padding,
    includeHiddenNodes: false,
    minZoom: 0.35,
    maxZoom,
    duration,
  })

  // After fit settles, bias focus left so the reading cloud sits in the clear
  if (!focus || opts.camera === 'hub') return noop

  const bias = () => {
    const n = focusId ? rf.getNode(focusId) : null
    if (!n) return
    const nw = n.measured?.width ?? 160
    const nh = n.measured?.height ?? 48
    const zoom = Math.min(maxZoom, Math.max(rf.getZoom(), maxZoom * 0.72))
    const shiftX = (opts.coarse ? 72 : 110) / zoom
    void rf.setCenter(n.position.x + nw / 2 + shiftX, n.position.y + nh / 2, {
      zoom,
      duration: 420,
    })
  }

  const t1 = window.setTimeout(bias, 320)
  const t2 = window.setTimeout(bias, 780)
  return () => {
    window.clearTimeout(t1)
    window.clearTimeout(t2)
  }
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
