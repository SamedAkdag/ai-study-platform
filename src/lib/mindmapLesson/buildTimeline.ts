import type {
  NarratedMindMapData,
  LessonStep,
  LessonCamera,
} from '@/lib/mindmapLesson/types'
import { LESSON_TRANSITIONS } from '@/lib/mindmapLesson/transitions'
import { fillMindMapNarrations } from '@/lib/mindmapLesson/fillNarrations'
import type { MindMapData } from '@/types/database'

/**
 * Pedagogical walk:
 * 1) Hub overview (central + roadmap of main branches)
 * 2) For each main branch: overview, then leaf details one by one
 * 3) Soft close
 *
 * Leaf camera = parent + all sibling leaves (family frame).
 */
export function buildLessonSteps(
  data: MindMapData | NarratedMindMapData,
  opts?: { markdown?: string | null; unitTitle?: string },
): LessonStep[] {
  const map = fillMindMapNarrations(data, opts?.markdown, opts?.unitTitle)
  const steps: LessonStep[] = []
  let n = 0
  const push = (
    step: Omit<LessonStep, 'id' | 'camera'> & { camera?: LessonCamera },
  ) => {
    const text = step.text.replace(/\s+/g, ' ').trim()
    if (text.length < 3) return
    const camera =
      step.camera ??
      (step.nodeId === 'central' || step.depth === 0
        ? 'hub'
        : step.nodeId.includes('-l-') || step.depth >= 2
          ? 'leaf'
          : 'branch')
    steps.push({ ...step, text, camera, id: `s-${n++}` })
  }

  const branchTitles = map.branches.map((b) => b.label)

  // —— 1) Hub: topic + first-level roadmap ——
  push({
    nodeId: 'central',
    text: LESSON_TRANSITIONS.lessonOpen(map.central),
    type: 'transition',
    parentId: null,
    depth: 0,
    title: map.central,
    camera: 'hub',
  })
  push({
    nodeId: 'central',
    text: map.narration || map.central,
    type: 'narration',
    parentId: null,
    depth: 0,
    title: map.central,
    camera: 'hub',
  })
  if (branchTitles.length) {
    push({
      nodeId: 'central',
      text: LESSON_TRANSITIONS.branchesRoadmap(branchTitles),
      type: 'transition',
      parentId: null,
      depth: 0,
      title: map.central,
      camera: 'hub',
    })
  }

  // —— 2) Each main branch: overview, then leaf details ——
  map.branches.forEach((branch, bi) => {
    const bid = `b-${bi}`
    const kids = branch.children ?? []

    push({
      nodeId: bid,
      text: LESSON_TRANSITIONS.branchEnter(branch.label),
      type: 'transition',
      parentId: 'central',
      depth: 1,
      title: branch.label,
      camera: 'branch',
    })
    push({
      nodeId: bid,
      text: branch.narration || branch.label,
      type: 'narration',
      parentId: 'central',
      depth: 1,
      title: branch.label,
      camera: 'branch',
    })

    if (kids.length) {
      push({
        nodeId: bid,
        text: LESSON_TRANSITIONS.leavesIntro(branch.label),
        type: 'transition',
        parentId: 'central',
        depth: 1,
        title: branch.label,
        camera: 'branch',
      })
    }

    kids.forEach((child, ci) => {
      const lid = `${bid}-l-${ci}`
      // No repetitive "leaf enter" line — go straight to unique detail
      push({
        nodeId: lid,
        text: branch.child_narrations?.[ci] || child,
        type: 'narration',
        parentId: bid,
        depth: 2,
        title: child,
        camera: 'leaf',
      })
    })

    if (kids.length || branch.narration) {
      push({
        nodeId: bid,
        text: LESSON_TRANSITIONS.branchClose(branch.label),
        type: 'transition',
        parentId: 'central',
        depth: 1,
        title: branch.label,
        camera: 'branch',
      })
    }
  })

  push({
    nodeId: 'central',
    text: LESSON_TRANSITIONS.rootClose(branchTitles),
    type: 'transition',
    parentId: null,
    depth: 0,
    title: map.central,
    camera: 'hub',
  })

  return steps
}
