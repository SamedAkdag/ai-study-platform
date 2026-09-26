import { supabase } from './supabase'
import type { PageText } from './slidingWindow'
import type { MergedChapter } from './mergeChapters'
import { buildStudyUnitsFromPages } from './buildStudyUnits'
import { buildPageOutlines } from './pageOutline'
import { sanitizeForPostgres } from './sanitize'
import { cleanTopicLabel, cleanTopicList, isGarbageTitle } from './titleQuality'

const CALL_GAP_MS = 3000
const PAGES_PER_BATCH = 20
const BATCH_OVERLAP = 2

type AiChapter = {
  start_page: number
  end_page: number
  title: string
  summary: string
  subtopics: string[]
}

/**
 * Topic-aware study sessions (~15–25 min), not fixed page counts.
 * Falls back to local packs if AI fails.
 */
export async function segmentStudyUnits(input: {
  bookTitle: string
  pages: PageText[]
}): Promise<MergedChapter[]> {
  if (input.pages.length === 0) return []

  const outlines = buildPageOutlines(input.pages)
  const minPage = outlines[0]!.pageNumber
  const maxPage = outlines[outlines.length - 1]!.pageNumber

  const collected: AiChapter[] = []

  for (
    let start = minPage;
    start <= maxPage;
    start += PAGES_PER_BATCH - BATCH_OVERLAP
  ) {
    const end = Math.min(start + PAGES_PER_BATCH - 1, maxPage)
    const batchPages = outlines.filter(
      (p) => p.pageNumber >= start && p.pageNumber <= end,
    )

    try {
      const { data, error } = await supabase.functions.invoke(
        'segment-study-units',
        {
          body: {
            book_title: input.bookTitle,
            range_start: start,
            range_end: end,
            pages: batchPages.map((p) => ({
              page: p.pageNumber,
              headings: p.headings,
              excerpt: sanitizeForPostgres(p.excerpt),
            })),
          },
        },
      )

      if (error) throw error
      if (data?.error) throw new Error(String(data.error))

      const chapters = (data?.chapters ?? []) as AiChapter[]
      for (const ch of chapters) {
        if (
          typeof ch.start_page === 'number' &&
          typeof ch.end_page === 'number' &&
          ch.start_page <= ch.end_page
        ) {
          const title =
            cleanTopicLabel(ch.title || '') ||
            cleanTopicList(ch.subtopics ?? [])[0] ||
            ''
          collected.push({
            start_page: ch.start_page,
            end_page: ch.end_page,
            title: sanitizeForPostgres(title),
            summary: sanitizeForPostgres(ch.summary || ''),
            subtopics: cleanTopicList(ch.subtopics ?? []).map(sanitizeForPostgres),
          })
        }
      }
    } catch (err) {
      console.warn('segment-study-units batch failed', start, end, err)
    }

    if (end >= maxPage) break
    await sleep(CALL_GAP_MS)
  }

  const merged = stitchBatches(collected, minPage, maxPage)
  if (merged.length === 0) {
    // Fallback: local ~5 page packs + local headings as subtopics
    return buildStudyUnitsFromPages(input.pages).map((u) => ({
      ...u,
      key_concepts: headingsInRange(outlines, u.start_page, u.end_page),
    }))
  }

  // Fill any coverage gaps with local packs
  const filled = fillGaps(merged, outlines, minPage, maxPage)

  return filled.map((ch, i) => {
    const localHeads = headingsInRange(outlines, ch.start_page, ch.end_page)
    const subtopics = cleanTopicList(
      ch.subtopics.length ? ch.subtopics : localHeads,
    )
    let title = cleanTopicLabel(ch.title) || subtopics[0] || ''
    if (!title || isGarbageTitle(title)) {
      title = `Konu çalışması ${i + 1}`
    }

    return {
      chapter_number: i + 1,
      title: sanitizeForPostgres(title),
      start_page: ch.start_page,
      end_page: ch.end_page,
      summary: sanitizeForPostgres(
        ch.summary || `Yaklaşık 20 dakikalık çalışma: ${title}`,
      ),
      key_concepts: subtopics.map(sanitizeForPostgres),
    }
  })
}

function stitchBatches(
  chapters: AiChapter[],
  minPage: number,
  maxPage: number,
): AiChapter[] {
  if (chapters.length === 0) return []

  const sorted = [...chapters].sort(
    (a, b) => a.start_page - b.start_page || a.end_page - b.end_page,
  )

  const out: AiChapter[] = []
  for (const ch of sorted) {
    const clamped: AiChapter = {
      ...ch,
      start_page: Math.max(minPage, ch.start_page),
      end_page: Math.min(maxPage, ch.end_page),
    }
    if (clamped.start_page > clamped.end_page) continue

    const last = out[out.length - 1]
    if (!last) {
      out.push(clamped)
      continue
    }

    // Overlap from batch window: prefer earlier chapter, trim the new one
    if (clamped.start_page <= last.end_page) {
      if (clamped.end_page <= last.end_page) continue
      const nextStart = last.end_page + 1
      if (nextStart > clamped.end_page) continue
      out.push({ ...clamped, start_page: nextStart })
      continue
    }

    out.push(clamped)
  }

  return out
}

function fillGaps(
  chapters: AiChapter[],
  outlines: ReturnType<typeof buildPageOutlines>,
  minPage: number,
  maxPage: number,
): AiChapter[] {
  const sorted = [...chapters].sort((a, b) => a.start_page - b.start_page)
  const result: AiChapter[] = []
  let cursor = minPage

  for (const ch of sorted) {
    if (ch.start_page > cursor) {
      result.push(
        ...localPackRange(outlines, cursor, ch.start_page - 1),
      )
    }
    result.push(ch)
    cursor = ch.end_page + 1
  }

  if (cursor <= maxPage) {
    result.push(...localPackRange(outlines, cursor, maxPage))
  }

  return result
}

function localPackRange(
  outlines: ReturnType<typeof buildPageOutlines>,
  startPage: number,
  endPage: number,
): AiChapter[] {
  const pages = outlines.filter(
    (p) => p.pageNumber >= startPage && p.pageNumber <= endPage,
  )
  if (pages.length === 0) return []

  const asPageText = pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: p.excerpt,
  }))
  return buildStudyUnitsFromPages(asPageText).map((u) => ({
    start_page: u.start_page,
    end_page: u.end_page,
    title: u.title,
    summary: u.summary || '',
    subtopics: headingsInRange(outlines, u.start_page, u.end_page),
  }))
}

function headingsInRange(
  outlines: ReturnType<typeof buildPageOutlines>,
  start: number,
  end: number,
): string[] {
  const heads = outlines
    .filter((p) => p.pageNumber >= start && p.pageNumber <= end)
    .flatMap((p) => p.headings)
  return [...new Set(heads)].slice(0, 8)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
