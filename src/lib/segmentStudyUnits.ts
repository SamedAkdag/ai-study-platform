import { supabase } from './supabase'
import type { PageText } from './slidingWindow'
import type { MergedChapter } from './mergeChapters'
import { buildPageOutlines } from './pageOutline'
import { sanitizeForPostgres } from './sanitize'
import { cleanTopicLabel, cleanTopicList, isGarbageTitle } from './titleQuality'
import { extractFunctionsError } from './functionsError'
import { packMicrosIntoUnits, applyAiPackUnits, type MicroTopic } from './packStudyUnits'

const CALL_GAP_MS = 600
const PAGES_PER_BATCH = 16
const BATCH_OVERLAP = 1
const BATCH_TIMEOUT_MS = 60_000

type Outline = ReturnType<typeof buildPageOutlines>[number]

export type SegmentProgress = {
  phase: 'batch' | 'merge' | 'done' | 'error'
  batchIndex: number
  batchTotal: number
  pageStart?: number
  pageEnd?: number
  message: string
}

/**
 * MiMo → 1–2 page micro-topics, then pack into ~5-page study units (4–7).
 */
export async function segmentStudyUnits(input: {
  bookTitle: string
  pages: PageText[]
  onProgress?: (p: SegmentProgress) => void | Promise<void>
}): Promise<MergedChapter[]> {
  if (input.pages.length === 0) return []

  const outlines = buildPageOutlines(input.pages)
  const minPage = outlines[0]!.pageNumber
  const maxPage = outlines[outlines.length - 1]!.pageNumber

  const ranges: Array<{ start: number; end: number }> = []
  for (
    let start = minPage;
    start <= maxPage;
    start += PAGES_PER_BATCH - BATCH_OVERLAP
  ) {
    const end = Math.min(start + PAGES_PER_BATCH - 1, maxPage)
    ranges.push({ start, end })
    if (end >= maxPage) break
  }

  const collected: MicroTopic[] = []

  for (let i = 0; i < ranges.length; i += 1) {
    const { start, end } = ranges[i]!
    const batchPages = outlines.filter(
      (p) => p.pageNumber >= start && p.pageNumber <= end,
    )

    await input.onProgress?.({
      phase: 'batch',
      batchIndex: i + 1,
      batchTotal: ranges.length,
      pageStart: start,
      pageEnd: end,
      message: `MiMo alt başlıklar ${i + 1}/${ranges.length} — s. ${start}–${end}`,
    })

    try {
      let micros: MicroTopic[] = []
      let lastBatchErr: unknown = null

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          if (attempt > 0) {
            await input.onProgress?.({
              phase: 'batch',
              batchIndex: i + 1,
              batchTotal: ranges.length,
              pageStart: start,
              pageEnd: end,
              message: `Batch ${i + 1}/${ranges.length} yeniden deneniyor (${attempt + 1}/3)…`,
            })
            await sleep(1500 * attempt)
          }
          micros = await withTimeout(
            invokeSegmentBatch({
              bookTitle: input.bookTitle,
              start,
              end,
              batchPages,
            }),
            BATCH_TIMEOUT_MS,
          )
          if (micros.length) {
            lastBatchErr = null
            break
          }
          lastBatchErr = new Error('MiMo boş alt başlık listesi döndü')
        } catch (err) {
          lastBatchErr = err
        }
      }

      if (!micros.length) {
        // Don't kill the whole book — fill this range from local headings
        const local = localMicrosFromOutlines(batchPages, start, end)
        await input.onProgress?.({
          phase: 'batch',
          batchIndex: i + 1,
          batchTotal: ranges.length,
          pageStart: start,
          pageEnd: end,
          message: `Batch ${i + 1} MiMo boş/hata — yerel alt başlık (${local.length}): ${
            lastBatchErr instanceof Error ? lastBatchErr.message : String(lastBatchErr)
          }`,
        })
        collected.push(...local)
      } else {
        for (const m of micros) {
          if (
            typeof m.start_page !== 'number' ||
            typeof m.end_page !== 'number' ||
            m.start_page > m.end_page
          ) {
            continue
          }
          const title = cleanTopicLabel(m.title || '') || m.title.trim()
          collected.push({
            start_page: m.start_page,
            end_page: m.end_page,
            title: sanitizeForPostgres(title),
            summary: sanitizeForPostgres(m.summary || ''),
          })
        }

        await input.onProgress?.({
          phase: 'batch',
          batchIndex: i + 1,
          batchTotal: ranges.length,
          pageStart: start,
          pageEnd: end,
          message: `Batch ${i + 1}/${ranges.length} tamam — ${micros.length} alt başlık`,
        })
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const full = `MiMo ünite ayırma hatası [batch ${i + 1}/${ranges.length}, s. ${start}–${end}]: ${detail}`
      await input.onProgress?.({
        phase: 'error',
        batchIndex: i + 1,
        batchTotal: ranges.length,
        pageStart: start,
        pageEnd: end,
        message: full,
      })
      throw new Error(full)
    }

    if (i < ranges.length - 1) await sleep(CALL_GAP_MS)
  }

  await input.onProgress?.({
    phase: 'merge',
    batchIndex: ranges.length,
    batchTotal: ranges.length,
    message: 'MiMo alt başlıkları ~5 sayfalık ünitelerde grupluyor (adım 2)…',
  })

  const stitched = stitchMicros(collected, minPage, maxPage)
  if (stitched.length === 0) {
    throw new Error('MiMo geçerli alt başlık üretmedi (boş sonuç).')
  }

  let packed: MergedChapter[] | null = null
  try {
    packed = await withTimeout(
      invokeAiPackUnits({
        bookTitle: input.bookTitle,
        micros: stitched,
      }),
      BATCH_TIMEOUT_MS,
    )
  } catch (err) {
    console.warn('AI pack failed, using local packer', err)
    await input.onProgress?.({
      phase: 'merge',
      batchIndex: ranges.length,
      batchTotal: ranges.length,
      message: `AI gruplama başarısız, yerel paketleyici: ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  }

  if (!packed || packed.length === 0) {
    packed = packMicrosIntoUnits(stitched)
  }

  if (!packed.length) {
    throw new Error('Alt başlıklardan ünite paketlenemedi.')
  }

  await input.onProgress?.({
    phase: 'done',
    batchIndex: ranges.length,
    batchTotal: ranges.length,
    message: `${stitched.length} alt başlık → ${packed.length} ünite (~5 sayfa)`,
  })

  return packed.map((u, i) => {
    let title = cleanTopicLabel(u.title) || u.key_concepts[0] || ''
    if (!title || isGarbageTitle(title)) title = `Ünite ${i + 1}`
    const subs = cleanTopicList(u.key_concepts)
    return {
      ...u,
      chapter_number: i + 1,
      title: sanitizeForPostgres(title),
      summary: sanitizeForPostgres(
        u.summary ||
          `s. ${u.start_page}–${u.end_page} · ${subs.length} alt başlık`,
      ),
      key_concepts: subs.map(sanitizeForPostgres),
    }
  })
}

async function invokeSegmentBatch(input: {
  bookTitle: string
  start: number
  end: number
  batchPages: Outline[]
}): Promise<MicroTopic[]> {
  const { data, error } = await supabase.functions.invoke('segment-study-units', {
    body: {
      book_title: input.bookTitle,
      range_start: input.start,
      range_end: input.end,
      pages: input.batchPages.map((p) => ({
        page: p.pageNumber,
        headings: p.headings,
        excerpt: sanitizeForPostgres(p.excerpt),
      })),
    },
  })

  if (error) throw new Error(await extractFunctionsError(error, data))
  if (data?.error) throw new Error(String(data.error))

  return (data?.micro_topics ?? data?.chapters ?? []) as MicroTopic[]
}

async function invokeAiPackUnits(input: {
  bookTitle: string
  micros: MicroTopic[]
}): Promise<MergedChapter[]> {
  // Chunk large lists so the model stays reliable
  const CHUNK = 40
  if (input.micros.length <= CHUNK) {
    return packOneWindow(input.bookTitle, input.micros, 0)
  }

  const parts: MergedChapter[] = []
  for (let i = 0; i < input.micros.length; i += CHUNK) {
    const slice = input.micros.slice(i, i + CHUNK)
    const packed = await packOneWindow(input.bookTitle, slice, i)
    parts.push(...packed)
    if (i + CHUNK < input.micros.length) await sleep(CALL_GAP_MS)
  }
  return parts.map((u, i) => ({ ...u, chapter_number: i + 1 }))
}

async function packOneWindow(
  bookTitle: string,
  micros: MicroTopic[],
  indexOffset: number,
): Promise<MergedChapter[]> {
  const { data, error } = await supabase.functions.invoke('pack-study-units', {
    body: {
      book_title: bookTitle,
      micro_topics: micros.map((m, i) => ({
        index: i,
        start_page: m.start_page,
        end_page: m.end_page,
        title: m.title,
        summary: m.summary || '',
      })),
    },
  })

  if (error) throw new Error(await extractFunctionsError(error, data))
  if (data?.error) throw new Error(String(data.error))

  const units = (data?.units ?? []) as Array<{
    title: string
    summary?: string
    micro_indexes: number[]
  }>

  const applied = applyAiPackUnits(micros, units)
  if (!applied) {
    throw new Error(
      `AI ünite gruplaması geçersiz (offset ${indexOffset}, ${micros.length} micro)`,
    )
  }
  return applied
}

function stitchMicros(
  micros: MicroTopic[],
  minPage: number,
  maxPage: number,
): MicroTopic[] {
  if (micros.length === 0) return []

  const sorted = [...micros].sort(
    (a, b) => a.start_page - b.start_page || a.end_page - b.end_page,
  )

  const out: MicroTopic[] = []
  for (const m of sorted) {
    const clamped: MicroTopic = {
      ...m,
      start_page: Math.max(minPage, m.start_page),
      end_page: Math.min(maxPage, m.end_page),
    }
    if (clamped.start_page > clamped.end_page) continue

    const last = out[out.length - 1]
    if (!last) {
      out.push(clamped)
      continue
    }

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

/** Local 1–2 page micros from detected headings when MiMo returns empty. */
function localMicrosFromOutlines(
  batchPages: Outline[],
  rangeStart: number,
  rangeEnd: number,
): MicroTopic[] {
  const pages = batchPages.filter(
    (p) => p.pageNumber >= rangeStart && p.pageNumber <= rangeEnd,
  )
  if (pages.length === 0) {
    return [
      {
        start_page: rangeStart,
        end_page: Math.min(rangeStart + 1, rangeEnd),
        title: `Konu s. ${rangeStart}`,
        summary: '',
      },
    ]
  }

  const out: MicroTopic[] = []
  let i = 0
  while (i < pages.length) {
    const start = pages[i]!
    const endIdx = Math.min(i + 1, pages.length - 1) // ~2 pages
    const end = pages[endIdx]!
    const title =
      cleanTopicLabel(start.headings[0] || '') ||
      `Konu s. ${start.pageNumber}–${end.pageNumber}`
    out.push({
      start_page: start.pageNumber,
      end_page: end.pageNumber,
      title: sanitizeForPostgres(title),
      summary: sanitizeForPostgres(
        start.excerpt.slice(0, 120) || `Sayfa ${start.pageNumber}–${end.pageNumber}`,
      ),
    })
    i = endIdx + 1
  }
  return out
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(
      () =>
        reject(
          new Error(
            `Timeout ${ms / 1000}s — Edge Function / Token Harbor yanıt vermedi`,
          ),
        ),
      ms,
    )
    promise
      .then((v) => {
        window.clearTimeout(id)
        resolve(v)
      })
      .catch((err) => {
        window.clearTimeout(id)
        reject(err)
      })
  })
}
