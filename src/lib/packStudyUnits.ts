import type { MergedChapter } from './mergeChapters'
import { packToTargetLength } from './mergeChapters'
import { cleanTopicLabel, isGarbageTitle } from './titleQuality'

export type MicroTopic = {
  start_page: number
  end_page: number
  title: string
  summary?: string
}

export type AiPackUnit = {
  title: string
  summary?: string
  micro_indexes: number[]
}

const MICRO_MAX_PAGES = 3
const UNIT_TARGET = 5
const UNIT_MIN = 4
const UNIT_MAX = 7

/**
 * Apply AI grouping of micros into units. Returns null if grouping is invalid.
 */
export function applyAiPackUnits(
  micros: MicroTopic[],
  units: AiPackUnit[],
): MergedChapter[] | null {
  if (!units.length || !micros.length) return null

  const used = new Set<number>()
  const out: MergedChapter[] = []

  for (const u of units) {
    const idxs = (u.micro_indexes || [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < micros.length)

    if (idxs.length === 0) return null

    for (let i = 1; i < idxs.length; i += 1) {
      if (idxs[i]! !== idxs[i - 1]! + 1) return null
    }

    for (const idx of idxs) {
      if (used.has(idx)) return null
      used.add(idx)
    }

    const members = idxs.map((i) => micros[i]!)
    const start_page = members[0]!.start_page
    const end_page = members[members.length - 1]!.end_page
    if (start_page > end_page) return null

    const pageN = end_page - start_page + 1
    if (pageN < 1 || pageN > 12) return null

    const subs = uniqueKeepOrder(members.map((m) => m.title))
    let title =
      cleanTopicLabel(u.title || '') ||
      cleanTopicLabel(members[0]!.title) ||
      subs[0] ||
      'Ünite'
    if (isGarbageTitle(title)) title = subs[0] || 'Ünite'

    out.push({
      chapter_number: out.length + 1,
      title,
      start_page,
      end_page,
      summary:
        (u.summary || '').trim() ||
        members
          .map((m) => m.summary)
          .filter(Boolean)
          .slice(0, 2)
          .join(' · ') ||
        `${pageN} sayfa · ${subs.length} alt başlık`,
      key_concepts: subs.slice(0, 8),
    })
  }

  if (used.size !== micros.length) return null

  return out
}

/**
 * Local fallback: pack 1–2 page micro-topics into ~5-page study units (4–7).
 */
export function packMicrosIntoUnits(micros: MicroTopic[]): MergedChapter[] {
  const cleaned = micros
    .map((m) => ({
      start_page: m.start_page,
      end_page: m.end_page,
      title: cleanTopicLabel(m.title) || m.title.trim(),
      summary: (m.summary || '').trim(),
    }))
    .filter(
      (m) =>
        m.start_page <= m.end_page &&
        m.end_page - m.start_page + 1 <= MICRO_MAX_PAGES + 1 &&
        m.title.length >= 2 &&
        !isGarbageTitle(m.title),
    )
    .sort((a, b) => a.start_page - b.start_page || a.end_page - b.end_page)

  if (cleaned.length === 0) return []

  const asChapters: MergedChapter[] = cleaned.map((m, i) => ({
    chapter_number: i + 1,
    title: m.title,
    start_page: m.start_page,
    end_page: m.end_page,
    summary: m.summary || null,
    key_concepts: [m.title],
  }))

  const packed = packToTargetLength(asChapters, {
    target: UNIT_TARGET,
    min: UNIT_MIN,
    max: UNIT_MAX,
  })

  return packed.map((u, i) => {
    const subs = uniqueKeepOrder(
      u.key_concepts.length > 0 ? u.key_concepts : [u.title],
    )
    let title = cleanTopicLabel(u.title) || subs[0] || `Ünite ${i + 1}`
    if (isGarbageTitle(title)) title = `Ünite ${i + 1}`

    const pageN = u.end_page - u.start_page + 1
    return {
      ...u,
      chapter_number: i + 1,
      title,
      key_concepts: subs.slice(0, 8),
      summary:
        u.summary ||
        `${pageN} sayfa · ${subs.length} alt başlık: ${subs.slice(0, 3).join(', ')}${
          subs.length > 3 ? '…' : ''
        }`,
    }
  })
}

function uniqueKeepOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}
