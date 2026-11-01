/** Guided mind-map lesson types (client-side narration + TTS timeline). */

export type LessonStepType = 'narration' | 'transition'

/** Cinematic camera frame for map sync. */
export type LessonCamera = 'hub' | 'branch' | 'leaf'

export type LessonStep = {
  id: string
  nodeId: string
  text: string
  type: LessonStepType
  parentId: string | null
  depth: number
  title: string
  camera: LessonCamera
}

export type LessonWord = {
  w: string
  s: number
  e: number
  segmentId: string
}

export type LessonSegment = {
  id: string
  nodeId: string
  type: LessonStepType
  text: string
  title: string
  camera: LessonCamera
  start: number
  end: number
  /** WAV blob for this segment (48 kHz mono) */
  blob: Blob
}

export type LessonTimeline = {
  totalDuration: number
  words: LessonWord[]
  segments: LessonSegment[]
}

export type NarratedMindMapNode = {
  id: string
  title: string
  narration: string
  children: NarratedMindMapNode[]
}

/** AI / stored mind_map with optional narrations (backward compatible). */
export type NarratedMindMapData = {
  central: string
  narration?: string
  branches: Array<{
    label: string
    narration?: string
    children?: string[]
    child_narrations?: string[]
    page?: number | null
  }>
}
