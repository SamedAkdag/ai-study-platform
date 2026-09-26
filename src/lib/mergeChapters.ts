export type WindowSegmentResult = {
  windowIndex: number
  startPage: number
  endPage: number
  chapters: Array<{
    title: string
    start_page: number
    end_page: number
    summary?: string
    key_concepts?: string[]
  }>
}

export type MergedChapter = {
  chapter_number: number
  title: string
  start_page: number
  end_page: number
  summary: string | null
  key_concepts: string[]
}

const TARGET_PAGES = 5
const MIN_PAGES = 4
const MAX_PAGES = 7

type Proposal = {
  title: string
  start_page: number
  end_page: number
  summary: string | null
  key_concepts: string[]
}

/**
 * Merge overlapping window proposals, then pack into ~5-page study units.
 * Subheadings may share one unit; we do not keep 1-page micro-chapters.
 */
export function mergeWindowChapters(
  windows: WindowSegmentResult[],
): MergedChapter[] {
  const proposals = collectProposals(windows)
  if (proposals.length === 0) {
    return packFromWindows(windows)
  }

  const rough = stitchProposals(proposals)
  const packed = packToTargetLength(rough)
  return packed.map((c, i) => ({ ...c, chapter_number: i + 1 }))
}

function collectProposals(windows: WindowSegmentResult[]): Proposal[] {
  return windows
    .flatMap((w) =>
      w.chapters.map((c) => ({
        title: c.title.trim(),
        start_page: c.start_page,
        end_page: c.end_page,
        summary: c.summary?.trim() || null,
        key_concepts: c.key_concepts ?? [],
      })),
    )
    .filter((c) => c.title && c.start_page <= c.end_page)
    .sort((a, b) => a.start_page - b.start_page || a.end_page - b.end_page)
}

/** Fallback: one study unit per sliding window (non-overlapping stride). */
function packFromWindows(windows: WindowSegmentResult[]): MergedChapter[] {
  const sorted = [...windows].sort((a, b) => a.startPage - b.startPage)
  const units: MergedChapter[] = []

  for (const w of sorted) {
    const last = units[units.length - 1]
    if (last && w.startPage <= last.end_page) {
      // Overlap window — extend only if still under MAX, else skip as overlap
      if (pageCount(last) < TARGET_PAGES) {
        last.end_page = Math.max(last.end_page, Math.min(w.endPage, last.start_page + MAX_PAGES - 1))
      }
      continue
    }

    units.push({
      chapter_number: units.length + 1,
      title: `Sayfa ${w.startPage}–${w.endPage}`,
      start_page: w.startPage,
      end_page: w.endPage,
      summary: null,
      key_concepts: [],
    })
  }

  return packToTargetLength(units).map((c, i) => ({ ...c, chapter_number: i + 1 }))
}

function stitchProposals(proposals: Proposal[]): MergedChapter[] {
  const merged: MergedChapter[] = []

  for (const proposal of proposals) {
    const last = merged[merged.length - 1]
    const sameTopic =
      last &&
      normalizeTitle(last.title) === normalizeTitle(proposal.title) &&
      proposal.start_page <= last.end_page + 1

    if (sameTopic && last) {
      last.end_page = Math.max(last.end_page, proposal.end_page)
      if (!last.summary && proposal.summary) last.summary = proposal.summary
      last.key_concepts = uniqueStrings([
        ...last.key_concepts,
        ...proposal.key_concepts,
      ])
      continue
    }

    if (last && proposal.start_page <= last.end_page) {
      if (proposal.start_page === last.start_page) {
        merged[merged.length - 1] = {
          chapter_number: last.chapter_number,
          title: proposal.title,
          start_page: proposal.start_page,
          end_page: proposal.end_page,
          summary: proposal.summary,
          key_concepts: uniqueStrings(proposal.key_concepts),
        }
        continue
      }
      last.end_page = Math.max(last.start_page, proposal.start_page - 1)
    }

    merged.push({
      chapter_number: merged.length + 1,
      title: proposal.title,
      start_page: proposal.start_page,
      end_page: proposal.end_page,
      summary: proposal.summary,
      key_concepts: uniqueStrings(proposal.key_concepts),
    })
  }

  return merged
}

/** Greedily merge short segments into ~5-page study units (max 7 if topic spills). */
export function packToTargetLength(
  chapters: MergedChapter[],
  opts?: { target?: number; min?: number; max?: number },
): MergedChapter[] {
  const target = opts?.target ?? TARGET_PAGES
  const min = opts?.min ?? MIN_PAGES
  const max = opts?.max ?? MAX_PAGES

  if (chapters.length === 0) return []

  const sorted = [...chapters].sort(
    (a, b) => a.start_page - b.start_page || a.end_page - b.end_page,
  )

  const packed: MergedChapter[] = []
  let bucket: MergedChapter | null = null

  for (const chapter of sorted) {
    if (!bucket) {
      bucket = { ...chapter, key_concepts: [...chapter.key_concepts] }
      continue
    }

    const combinedEnd = Math.max(bucket.end_page, chapter.end_page)
    const combinedCount = combinedEnd - bucket.start_page + 1
    const bucketCount = pageCount(bucket)

    const shouldAbsorb =
      bucketCount < min ||
      (bucketCount < target && combinedCount <= max) ||
      (combinedCount <= max && pageCount(chapter) < min)

    if (shouldAbsorb && combinedCount <= max) {
      bucket = absorb(bucket, chapter, combinedEnd)
      continue
    }

    // Close bucket if large enough; otherwise keep absorbing even slightly over target
    if (bucketCount >= min) {
      packed.push(bucket)
      bucket = { ...chapter, key_concepts: [...chapter.key_concepts] }
    } else if (combinedCount <= max) {
      bucket = absorb(bucket, chapter, combinedEnd)
    } else {
      packed.push(bucket)
      bucket = { ...chapter, key_concepts: [...chapter.key_concepts] }
    }
  }

  if (bucket) {
    const prev = packed[packed.length - 1]
    if (prev && pageCount(bucket) < min) {
      const combinedEnd = bucket.end_page
      const combinedCount = combinedEnd - prev.start_page + 1
      if (combinedCount <= max + 1) {
        packed[packed.length - 1] = absorb(prev, bucket, combinedEnd)
      } else {
        packed.push(bucket)
      }
    } else {
      packed.push(bucket)
    }
  }

  return packed.map((c, i) => ({ ...c, chapter_number: i + 1 }))
}

function absorb(
  into: MergedChapter,
  from: MergedChapter,
  endPage: number,
): MergedChapter {
  return {
    ...into,
    title: pickUmbrellaTitle(into, from),
    end_page: endPage,
    summary: [into.summary, from.summary].filter(Boolean).join(' · ') || null,
    key_concepts: uniqueStrings([...into.key_concepts, ...from.key_concepts]).slice(
      0,
      6,
    ),
  }
}

function pickUmbrellaTitle(a: MergedChapter, b: MergedChapter): string {
  // Prefer the longer-running segment's title as umbrella
  if (pageCount(a) >= pageCount(b)) return a.title
  return b.title
}

function pageCount(c: { start_page: number; end_page: number }): number {
  return c.end_page - c.start_page + 1
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}
