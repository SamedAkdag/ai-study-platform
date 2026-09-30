/** Cascade depth labels (shared with UI). */
export const STUDY_DEPTHS = {
  K1: 'brief',
  K2: 'standard',
  K3: 'detailed',
} as const

export type StudyDepthKey = keyof typeof STUDY_DEPTHS

/** Pages per generation batch. */
export const MIMO_CHUNK_SIZE = 5
