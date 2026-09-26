import { supabase } from './supabase'
import type { PageText, PageWindow } from './slidingWindow'
import type { MergedChapter, WindowSegmentResult } from './mergeChapters'
import { mergeWindowChapters } from './mergeChapters'
import { sanitizeForPostgres } from './sanitize'

const MIN_WINDOW_CHARS = 120
const RETRY_PAD_PAGES = 2
const MAX_WINDOW_RETRIES = 2
const CALL_GAP_MS = 3000

export async function createBookRecord(input: {
  title: string
  totalPages: number
}) {
  const { data, error } = await supabase
    .from('books')
    .insert({
      title: sanitizeForPostgres(input.title),
      total_pages: input.totalPages,
      status: 'processing',
      progress_step: 'extracting',
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function segmentWindowsWithAi(
  windows: PageWindow[],
  onProgress?: (done: number, total: number, note?: string) => void,
  allPages?: PageText[],
) {
  const pages = allPages ?? windows.flatMap((w) => w.pages)
  const allResults: WindowSegmentResult[] = []

  for (let i = 0; i < windows.length; i += 1) {
    const base = windows[i]!
    onProgress?.(i, windows.length)

    let result = await invokeSegmentWindow(maybeEnrichWindow(base, pages, 0))

    let attempt = 0
    while (isWeakSegmentResult(result) && attempt < MAX_WINDOW_RETRIES) {
      attempt += 1
      onProgress?.(
        i,
        windows.length,
        `zayıf metin — sayfa ${base.startPage}–${base.endPage} yeniden deneniyor (${attempt}/${MAX_WINDOW_RETRIES})`,
      )
      await sleep(CALL_GAP_MS)
      const enriched = maybeEnrichWindow(base, pages, RETRY_PAD_PAGES * attempt)
      result = await invokeSegmentWindow(enriched)
    }

    // Still weak → keep a placeholder unit but mark summary clearly for UI
    if (isWeakSegmentResult(result)) {
      result = {
        windowIndex: base.windowIndex,
        startPage: base.startPage,
        endPage: base.endPage,
        chapters: [
          {
            title: `Çalışma ünitesi (s. ${base.startPage}–${base.endPage})`,
            start_page: base.startPage,
            end_page: base.endPage,
            summary:
              substantiveCharCount(base.text) < MIN_WINDOW_CHARS
                ? 'Bu sayfalardan yeterince metin çıkarılamadı (taranmış PDF olabilir).'
                : 'AI bu aralık için anlamlı özet üretemedi; sonraki milestone’da tekrar işlenebilir.',
            key_concepts: [],
          },
        ],
      }
    }

    allResults.push(result)

    if (i < windows.length - 1) {
      await sleep(CALL_GAP_MS)
    }
  }

  onProgress?.(windows.length, windows.length)
  return mergeWindowChapters(allResults)
}

async function invokeSegmentWindow(
  window: PageWindow,
): Promise<WindowSegmentResult> {
  const { data, error } = await supabase.functions.invoke('segment-chapters', {
    body: {
      windows: [
        {
          windowIndex: window.windowIndex,
          startPage: window.startPage,
          endPage: window.endPage,
          text: window.text,
        },
      ],
    },
  })

  if (error) {
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (body?.error) detail = String(body.error)
        else detail = `${detail} | ${JSON.stringify(body)}`
      }
    } catch {
      /* keep detail */
    }
    throw new Error(detail)
  }

  if (data?.error) {
    throw new Error(String(data.error))
  }

  const batch = (data?.windows ?? []) as WindowSegmentResult[]
  return (
    batch[0] ?? {
      windowIndex: window.windowIndex,
      startPage: window.startPage,
      endPage: window.endPage,
      chapters: [],
    }
  )
}

/** Expand window with neighboring pages when text is thin or on retry. */
function maybeEnrichWindow(
  window: PageWindow,
  allPages: PageText[],
  pad: number,
): PageWindow {
  const needsPad =
    pad > 0 || substantiveCharCount(window.text) < MIN_WINDOW_CHARS
  if (!needsPad || allPages.length === 0) return window

  const minPage = Math.max(
    1,
    window.startPage - (pad || RETRY_PAD_PAGES),
  )
  const maxPage = window.endPage + (pad || RETRY_PAD_PAGES)
  const slice = allPages.filter(
    (p) => p.pageNumber >= minPage && p.pageNumber <= maxPage,
  )
  if (slice.length === 0) return window

  return {
    ...window,
    // Keep original start/end for chapter bounds; send wider text as context
    text: [
      `(Context pages ${minPage}–${maxPage}; target study unit is still pages ${window.startPage}–${window.endPage})`,
      ...slice.map((p) => {
        const body = p.text.trim() || '[no extractable text on this page]'
        return `--- Page ${p.pageNumber} ---\n${body}`
      }),
    ].join('\n\n'),
  }
}

export function isWeakSegmentResult(result: WindowSegmentResult): boolean {
  if (!result.chapters || result.chapters.length === 0) return true

  return result.chapters.every((c) => isWeakChapter(c))
}

function isWeakChapter(c: {
  title: string
  summary?: string
  start_page: number
  end_page: number
}): boolean {
  const title = c.title.toLowerCase()
  const summary = (c.summary ?? '').toLowerCase()

  if (/no text provided/i.test(summary)) return true
  if (/not enough text/i.test(summary)) return true
  if (/content for pages/i.test(title)) return true
  if (/^pages?\s+\d+/i.test(c.title)) return true
  if (/insufficient|unavailable|empty excerpt/i.test(summary)) return true
  if (!c.title.trim()) return true

  return false
}

function substantiveCharCount(text: string): number {
  return text
    .replace(/---\s*Page\s+\d+\s*---/gi, '')
    .replace(/\[no extractable text[^\]]*\]/gi, '')
    .replace(/\s+/g, '')
    .length
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function saveChapters(
  bookId: string,
  chapters: MergedChapter[],
  pages: PageText[],
) {
  const rows = chapters.map((c) => {
    const page_text = sanitizeForPostgres(
      pages
        .filter((p) => p.pageNumber >= c.start_page && p.pageNumber <= c.end_page)
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join('\n\n'),
    )

    return {
      book_id: bookId,
      chapter_number: c.chapter_number,
      order_index: c.chapter_number,
      title: sanitizeForPostgres(c.title),
      start_page: c.start_page,
      end_page: c.end_page,
      summary: c.summary ? sanitizeForPostgres(c.summary) : null,
      key_concepts: (c.key_concepts ?? []).map(sanitizeForPostgres),
      page_text,
      status: 'pending' as const,
    }
  })

  const { data, error: chapterError } = await supabase
    .from('chapters')
    .insert(rows)
    .select('id, title, status, order_index')

  if (chapterError) throw chapterError

  const { error: bookError } = await supabase
    .from('books')
    .update({ status: 'processing', progress_step: 'segmenting' })
    .eq('id', bookId)

  if (bookError) throw bookError
  return data ?? []
}

/** Generate study materials for ONE chapter (on-demand when user opens it). */
export async function generateSingleChapterContent(input: {
  id: string
  title: string
  style?: string
}) {
  const { data, error } = await supabase.functions.invoke(
    'generate-chapter-content',
    {
      body: {
        chapter_id: input.id,
        title: input.title,
        style: input.style || undefined,
      },
    },
  )

  if (error) {
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (body?.error) detail = String(body.error)
      }
    } catch {
      /* keep */
    }
    await supabase.from('chapters').update({ status: 'failed' }).eq('id', input.id)
    throw new Error(detail)
  }

  if (data?.error) {
    await supabase.from('chapters').update({ status: 'failed' }).eq('id', input.id)
    throw new Error(String(data.error))
  }

  return data
}

export async function markBookReady(bookId: string) {
  const { error } = await supabase
    .from('books')
    .update({ status: 'ready', progress_step: 'ready' })
    .eq('id', bookId)
  if (error) throw error
}

export async function markBookFailed(bookId: string, message?: string) {
  await supabase
    .from('books')
    .update({
      status: 'failed',
      progress_step: 'failed',
      error_message: message ? message.slice(0, 1500) : null,
    })
    .eq('id', bookId)
}

export async function fetchBook(bookId: string) {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', bookId)
    .single()
  if (error) throw error
  return data
}

export async function fetchChapters(bookId: string) {
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
    .eq('book_id', bookId)
    .order('order_index', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function fetchChapter(chapterId: string) {
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
    .eq('id', chapterId)
    .single()
  if (error) throw error
  return data
}

/** Ask AI for topic titles + short summaries. Falls back to heuristics on failure. */
export async function nameStudyUnits(input: {
  bookTitle: string
  units: MergedChapter[]
  pages: PageText[]
}): Promise<MergedChapter[]> {
  const BATCH = 6
  const named = [...input.units]

  for (let start = 0; start < named.length; start += BATCH) {
    const batch = named.slice(start, start + BATCH)
    const payload = batch.map((u, i) => {
      const excerpt = input.pages
        .filter((p) => p.pageNumber >= u.start_page && p.pageNumber <= u.end_page)
        .map((p) => p.text)
        .join(' ')
        .slice(0, 900)

      return {
        index: start + i,
        start_page: u.start_page,
        end_page: u.end_page,
        excerpt: sanitizeForPostgres(excerpt),
      }
    })

    try {
      const { data, error } = await supabase.functions.invoke('name-study-units', {
        body: {
          book_title: input.bookTitle,
          units: payload,
        },
      })

      if (error) throw error
      if (data?.error) throw new Error(String(data.error))

      const results = (data?.units ?? []) as Array<{
        index: number
        title?: string
        summary?: string
        key_concepts?: string[]
      }>

      for (const r of results) {
        if (typeof r.index !== 'number' || !named[r.index]) continue
        const title = (r.title || '').trim()
        const summary = (r.summary || '').trim()
        if (title && !isBadTitle(title)) {
          named[r.index] = {
            ...named[r.index]!,
            title: sanitizeForPostgres(title),
            summary: summary
              ? sanitizeForPostgres(summary)
              : named[r.index]!.summary,
            key_concepts:
              Array.isArray(r.key_concepts) && r.key_concepts.length
                ? r.key_concepts.map(sanitizeForPostgres).slice(0, 3)
                : named[r.index]!.key_concepts,
          }
        } else if (summary) {
          named[r.index] = {
            ...named[r.index]!,
            summary: sanitizeForPostgres(summary),
          }
        }
      }
    } catch (err) {
      console.warn('name-study-units batch failed, keeping heuristics', err)
    }

    if (start + BATCH < named.length) {
      await sleep(CALL_GAP_MS)
    }
  }

  return named
}

function isBadTitle(title: string): boolean {
  const t = title.toLowerCase()
  return (
    /content for pages/i.test(t) ||
    /^pages?\s+\d+/i.test(t) ||
    /^ünite \(s\./i.test(t) ||
    /^sayfa\s+\d+/i.test(t) ||
    t.length < 3
  )
}

/** Inline selection chat: only selected passage + ~10 preceding lines. */
export async function askAboutSelection(input: {
  chapterId: string
  chapterTitle: string
  selectedText: string
  precedingContext: string
  question: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}) {
  const { data, error } = await supabase.functions.invoke('chat-with-chapter', {
    body: {
      chapter_id: input.chapterId,
      chapter_title: input.chapterTitle,
      selected_text: input.selectedText,
      preceding_context: input.precedingContext,
      question: input.question,
      history: input.history,
    },
  })

  if (error) {
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (body?.error) detail = String(body.error)
      }
    } catch {
      /* keep */
    }
    throw new Error(detail)
  }

  if (data?.error) throw new Error(String(data.error))
  if (typeof data?.answer !== 'string') throw new Error('Boş AI yanıtı')
  return data.answer as string
}
