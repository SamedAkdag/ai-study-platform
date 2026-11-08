/**
 * Map-ordered Dinle lesson script — AI narrations locked to mind-map nodes.
 */
import { packLectureTopics } from '@/lib/audioOverview'
import { extractFunctionsError } from '@/lib/functionsError'
import { supabase } from '@/lib/supabase'
import type { MindMapData } from '@/types/database'
import type { NarratedMindMapData } from '@/lib/mindmapLesson/types'

const CACHE_PREFIX = 'studium.lessonScript.v1:'

export type LessonScriptResult = {
  mindMap: NarratedMindMapData
  /** Stitched teacher prose for transcript / fill fallback */
  transcript: string
  source: 'ai' | 'cache'
}

function cacheKey(input: {
  chapterId?: string
  title: string
  mindMap: MindMapData
  markdown?: string | null
}): string {
  const labels = [
    input.mindMap.central,
    ...input.mindMap.branches.flatMap((b) => [
      b.label,
      ...(b.children ?? []),
    ]),
  ].join('|')
  const raw = `${input.chapterId || ''}|${input.title}|${labels}|${(
    input.markdown || ''
  ).slice(0, 280)}`
  let h = 0
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0
  return CACHE_PREFIX + String(h)
}

function speechOk(s: string | undefined | null, min = 40): boolean {
  return !!s && s.replace(/\s+/g, ' ').trim().length >= min
}

export function stitchLessonTranscript(map: NarratedMindMapData): string {
  const parts: string[] = []
  if (speechOk(map.narration, 30)) parts.push(map.narration!.trim())
  for (const b of map.branches) {
    if (speechOk(b.narration, 30)) parts.push(b.narration!.trim())
    const kids = b.children ?? []
    const narrs = b.child_narrations ?? []
    kids.forEach((_, i) => {
      if (speechOk(narrs[i], 24)) parts.push(String(narrs[i]).trim())
    })
  }
  return parts.join('\n\n').trim()
}

export function narrationCoverage(map: NarratedMindMapData): number {
  let need = 1
  let have = speechOk(map.narration, 40) ? 1 : 0
  for (const b of map.branches) {
    need += 1
    if (speechOk(b.narration, 40)) have += 1
    const kids = b.children ?? []
    need += kids.length
    const narrs = b.child_narrations ?? []
    kids.forEach((_, i) => {
      if (speechOk(narrs[i], 30)) have += 1
    })
  }
  return need <= 0 ? 0 : have / need
}

function normalizeLessonMindMap(
  raw: unknown,
  skeleton: MindMapData,
): NarratedMindMapData | null {
  if (!raw || typeof raw !== 'object') return null
  const mm = raw as {
    central?: unknown
    narration?: unknown
    branches?: unknown
  }
  const aiBranches = Array.isArray(mm.branches) ? mm.branches : []
  const byLabel = new Map<string, Record<string, unknown>>()
  for (const row of aiBranches) {
    if (!row || typeof row !== 'object') continue
    const lab = String((row as { label?: unknown }).label || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (lab) byLabel.set(lab, row as Record<string, unknown>)
  }

  const branches = skeleton.branches.map((sk, bi) => {
    const hit =
      byLabel.get(sk.label.toLowerCase()) ||
      (aiBranches[bi] as Record<string, unknown> | undefined)
    const kids = sk.children ?? []
    const rawKids = Array.isArray(hit?.child_narrations)
      ? (hit!.child_narrations as unknown[])
      : []
    const child_narrations = kids.map((_, i) =>
      String(rawKids[i] || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 700),
    )
    return {
      label: sk.label,
      children: kids,
      page: sk.page ?? null,
      narration: String(hit?.narration || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 900),
      child_narrations,
    }
  })

  const out: NarratedMindMapData = {
    central: skeleton.central,
    narration: String(mm.narration || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1100),
    branches,
  }
  if (narrationCoverage(out) < 0.35) return null
  return out
}

export function loadCachedLessonScript(input: {
  chapterId?: string
  title: string
  mindMap: MindMapData
  markdown?: string | null
}): LessonScriptResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(input))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { mindMap?: unknown }
    const mindMap = normalizeLessonMindMap(parsed.mindMap, input.mindMap)
    if (!mindMap) return null
    return {
      mindMap,
      transcript: stitchLessonTranscript(mindMap),
      source: 'cache',
    }
  } catch {
    return null
  }
}

function saveCachedLessonScript(
  input: {
    chapterId?: string
    title: string
    mindMap: MindMapData
    markdown?: string | null
  },
  mindMap: NarratedMindMapData,
): void {
  try {
    localStorage.setItem(cacheKey(input), JSON.stringify({ mindMap }))
  } catch {
    /* ignore quota */
  }
}

/** Merge AI narrations onto skeleton labels (structure from chapter map). */
export function mergeNarrationsOntoMap(
  skeleton: MindMapData,
  narrated: NarratedMindMapData | null | undefined,
): MindMapData {
  if (!narrated?.branches?.length) return skeleton
  const byLabel = new Map(
    narrated.branches.map((b) => [b.label.toLowerCase(), b]),
  )
  return {
    central: skeleton.central,
    narration: narrated.narration || skeleton.narration,
    branches: skeleton.branches.map((sk) => {
      const hit = byLabel.get(sk.label.toLowerCase())
      if (!hit) return sk
      const kids = sk.children ?? []
      const child_narrations = kids.map(
        (_, i) => hit.child_narrations?.[i] || '',
      )
      return {
        ...sk,
        narration: hit.narration || sk.narration,
        child_narrations,
      }
    }),
  }
}

/**
 * Generate map-locked teacher narrations. Falls back to null on failure
 * (caller keeps fillNarrations heuristic).
 */
export async function generateLessonScript(input: {
  chapterId?: string
  title: string
  summary?: string | null
  keyConcepts?: string[] | null
  markdown?: string | null
  mindMap: MindMapData
  force?: boolean
}): Promise<LessonScriptResult> {
  if (!input.force) {
    const cached = loadCachedLessonScript(input)
    if (cached && narrationCoverage(cached.mindMap) >= 0.5) return cached
  }

  if (input.mindMap.branches.length < 2) {
    throw new Error('Ders script’i için en az 2 ana dal gerekli')
  }

  const topics = packLectureTopics(
    input.markdown,
    input.title.trim() || 'Ünite',
  )

  const skeleton = {
    central: input.mindMap.central,
    branches: input.mindMap.branches.slice(0, 10).map((b) => ({
      label: b.label,
      page: b.page ?? null,
      children: (b.children ?? []).slice(0, 7),
    })),
  }

  const { data, error } = await supabase.functions.invoke(
    'generate-lesson-script',
    {
      body: {
        title: input.title,
        summary: input.summary || '',
        key_concepts: input.keyConcepts || [],
        markdown: (input.markdown || '').slice(0, 8000),
        topics,
        mind_map: skeleton,
      },
    },
  )

  if (error) {
    throw new Error(await extractFunctionsError(error, data))
  }
  if (data?.error) throw new Error(String(data.error))

  const mindMap = normalizeLessonMindMap(
    data?.mind_map ?? data,
    input.mindMap,
  )
  if (!mindMap) {
    throw new Error('AI ders script’i haritaya oturmadı')
  }

  saveCachedLessonScript(input, mindMap)
  return {
    mindMap,
    transcript: stitchLessonTranscript(mindMap),
    source: 'ai',
  }
}
