import { z } from 'zod'
import type { NarratedMindMapData } from '@/lib/mindmapLesson/types'

const branchSchema = z.object({
  label: z.string().min(1).max(80),
  narration: z.string().min(20).max(1200).optional(),
  children: z.array(z.string().min(1).max(80)).max(6).optional(),
  child_narrations: z.array(z.string().min(10).max(1200)).max(6).optional(),
  page: z.number().int().positive().nullable().optional(),
})

export const narratedMindMapSchema = z.object({
  central: z.string().min(1).max(80),
  narration: z.string().min(20).max(1200).optional(),
  branches: z.array(branchSchema).min(1).max(16),
})

export type NarratedMindMapParsed = z.infer<typeof narratedMindMapSchema>

export function validateNarratedMindMap(
  raw: unknown,
):
  | { ok: true; data: NarratedMindMapData }
  | { ok: false; error: string } {
  const parsed = narratedMindMapSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, data: parsed.data as NarratedMindMapData }
}

/** Soft word-count check for a narration paragraph. */
export function narrationWordCount(text: string): number {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length
}

export function clipNarration(text: string, maxWords = 120): string {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}.`
}

/**
 * Soft completeness check after fill: every branch needs a narration.
 * Used as the "retry once" gate — client refill, zero extra AI cost.
 */
export function narrationsComplete(data: NarratedMindMapData): boolean {
  if (!data.narration || narrationWordCount(data.narration) < 16) return false
  for (const b of data.branches) {
    if (!b.narration || narrationWordCount(b.narration) < 12) return false
    const kids = b.children ?? []
    const cn = b.child_narrations ?? []
    if (kids.length && cn.length < kids.length) return false
    for (let i = 0; i < kids.length; i++) {
      if (narrationWordCount(cn[i] || '') < 8) return false
    }
  }
  return true
}
