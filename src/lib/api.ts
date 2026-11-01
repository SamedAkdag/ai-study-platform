import { supabase } from './supabase'
import type { PageText, PageWindow } from './slidingWindow'
import type { MergedChapter, WindowSegmentResult } from './mergeChapters'
import { mergeWindowChapters } from './mergeChapters'
import { sanitizeForPostgres } from './sanitize'
import type {
  AiUsageEvent,
  ExampleItem,
  FlashcardItem,
  MindMapData,
  QuizItem,
} from '@/types/database'
import { extractFunctionsError } from './functionsError'
import { normalizeExample, normalizeQuiz } from './contributions'

const MIN_WINDOW_CHARS = 120
const RETRY_PAD_PAGES = 2
const MAX_WINDOW_RETRIES = 2
const CALL_GAP_MS = 3000

export async function createBookRecord(input: {
  title: string
  totalPages: number
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase
    .from('books')
    .insert({
      title: sanitizeForPostgres(input.title),
      total_pages: input.totalPages,
      status: 'processing',
      progress_step: 'extracting',
      user_id: session?.user?.id ?? null,
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
    throw new Error(await extractFunctionsError(error, data))
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

/** Generate standard notes for ONE chapter (single LLM call; full unit SOURCE). */
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
        chunk_index: 0,
      },
    },
  )

  if (error) {
    const detail = await extractFunctionsError(error, data)
    await supabase.from('chapters').update({ status: 'failed' }).eq('id', input.id)
    throw new Error(detail)
  }

  if (data?.error) {
    await supabase.from('chapters').update({ status: 'failed' }).eq('id', input.id)
    throw new Error(String(data.error))
  }

  if (!data?.done && data?.next_chunk != null) {
    // Legacy multi-chunk edge still deployed — finish remaining chunks.
    let chunkIndex = Number(data.next_chunk)
    let guard = 0
    while (guard < 8 && Number.isFinite(chunkIndex)) {
      guard += 1
      const cont = await supabase.functions.invoke('generate-chapter-content', {
        body: {
          chapter_id: input.id,
          title: input.title,
          style: input.style || undefined,
          chunk_index: chunkIndex,
        },
      })
      if (cont.error) {
        throw new Error(await extractFunctionsError(cont.error, cont.data))
      }
      if (cont.data?.error) throw new Error(String(cont.data.error))
      if (cont.data?.done) return cont.data
      const next = Number(cont.data?.next_chunk)
      if (!Number.isFinite(next) || next <= chunkIndex) break
      chunkIndex = next
    }
  }

  return data
}

export type ChapterArtifactKind =
  | 'brief'
  | 'detailed'
  | 'practice'
  | 'mind_map'

/**
 * Generate (or return DB-cached) chapter artifact on demand.
 * Initial “Üret” only builds standard notes; depths / drills / map load on click.
 */
export async function ensureChapterArtifact(input: {
  chapterId: string
  kind: ChapterArtifactKind
  title?: string
  force?: boolean
}) {
  const { data, error } = await supabase.functions.invoke(
    'generate-chapter-artifact',
    {
      body: {
        chapter_id: input.chapterId,
        kind: input.kind,
        title: input.title || undefined,
        force: input.force || false,
      },
    },
  )
  if (error) throw new Error(await extractFunctionsError(error, data))
  if (data?.error) throw new Error(String(data.error))
  return data as {
    ok: boolean
    cached: boolean
    kind: ChapterArtifactKind
    weak?: boolean
    quality?: { score?: number; ok?: boolean; issues?: string[] }
  }
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

export async function bumpBookStudySeconds(bookId: string, delta: number) {
  if (delta <= 0) return
  const { data: current, error: readError } = await supabase
    .from('books')
    .select('study_seconds')
    .eq('id', bookId)
    .maybeSingle()
  if (readError) throw readError
  const next = (current?.study_seconds ?? 0) + delta
  const { error } = await supabase
    .from('books')
    .update({ study_seconds: next })
    .eq('id', bookId)
  if (error) throw error
}

function makeShareToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export async function enableBookShare(bookId: string) {
  const token = makeShareToken()
  const { data, error } = await supabase
    .from('books')
    .update({ is_public: true, share_token: token })
    .eq('id', bookId)
    .select('*')
    .single()
  if (error) throw error
  const { bootstrapBookGroup } = await import('./studyGroup')
  await bootstrapBookGroup(bookId)
  return data
}

export async function disableBookShare(bookId: string) {
  const { data, error } = await supabase
    .from('books')
    .update({ is_public: false, share_token: null })
    .eq('id', bookId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function fetchPublicBook(token: string) {
  const primary = await supabase
    .from('public_shared_books')
    .select(
      'id, title, subject, share_token, created_at, is_public, view_count, share_count',
    )
    .eq('share_token', token)
    .maybeSingle()

  if (!primary.error && primary.data) return primary.data

  // Older view without stats columns
  const fallback = await supabase
    .from('public_shared_books')
    .select('id, title, subject, share_token, created_at')
    .eq('share_token', token)
    .maybeSingle()
  if (fallback.error) throw fallback.error
  if (!fallback.data) throw new Error('Paylaşım bulunamadı')
  return {
    ...fallback.data,
    is_public: true,
    view_count: 0,
    share_count: 0,
  }
}

/** Count a public-book open once per browser tab session. */
export async function recordPublicBookView(bookId: string) {
  const key = `studium-viewed:${bookId}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // private mode / blocked storage — still record once this call
  }
  const { error } = await supabase.rpc('record_book_view', {
    p_book_id: bookId,
  })
  if (error) {
    // Non-fatal: stats should not block reading
    console.warn('record_book_view', error.message)
  }
}

export type PublicChapter = {
  id: string
  book_id: string
  chapter_number: number
  order_index: number | null
  title: string
  summary: string | null
  key_concepts: string[] | null
  explanation: string | null
  explanation_brief: string | null
  explanation_detailed: string | null
  examples: ExampleItem[] | null
  quiz: QuizItem[] | null
  flashcards: FlashcardItem[] | null
  mind_map: MindMapData | null
  status: string
}

export async function fetchPublicChapters(bookId: string): Promise<PublicChapter[]> {
  const { data, error } = await supabase
    .from('public_shared_chapters')
    .select(
      'id, book_id, chapter_number, order_index, title, summary, key_concepts, explanation, explanation_brief, explanation_detailed, examples, quiz, flashcards, mind_map, status',
    )
    .eq('book_id', bookId)
    .order('order_index', { ascending: true })
  if (error) throw error
  return (data ?? []) as PublicChapter[]
}

export async function fetchPublicChapter(
  chapterId: string,
  bookId: string,
): Promise<PublicChapter> {
  const { data, error } = await supabase
    .from('public_shared_chapters')
    .select(
      'id, book_id, chapter_number, order_index, title, summary, key_concepts, explanation, explanation_brief, explanation_detailed, examples, quiz, flashcards, mind_map, status',
    )
    .eq('id', chapterId)
    .eq('book_id', bookId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Ünite bulunamadı')
  return data as PublicChapter
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

export async function updateChapterMarkdownField(input: {
  chapterId: string
  depth: 'brief' | 'standard' | 'detailed'
  markdown: string
}) {
  const patch =
    input.depth === 'brief'
      ? { explanation_brief: input.markdown }
      : input.depth === 'detailed'
        ? { explanation_detailed: input.markdown }
        : { explanation: input.markdown }

  const { data, error } = await supabase
    .from('chapters')
    .update(patch)
    .eq('id', input.chapterId)
    .select('*')
    .single()

  if (error) throw error
  return data
}
export async function askAboutSelection(input: {
  chapterId: string
  chapterTitle: string
  selectedText: string
  precedingContext: string
  followingContext?: string
  question: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Cropped chart/figure as data URL for MiMo vision. */
  imageDataUrl?: string
  /** When true, image_url is required (chart marquee). */
  requireImage?: boolean
  /**
   * lecture = spoken classroom monologue (Dinle / harita turu “Hocaya sor”)
   * notes = default selection-tutor markdown-friendly answer
   */
  answerFormat?: 'lecture' | 'notes'
}) {
  const imageUrl = (input.imageDataUrl || '').trim()
  if (input.requireImage && !imageUrl.startsWith('data:image/')) {
    throw new Error(
      'Grafik görüntüsü eksik — alanı yeniden seç (⬚ Alan).',
    )
  }

  const { data, error } = await supabase.functions.invoke('chat-with-chapter', {
    body: {
      chapter_id: input.chapterId,
      chapter_title: input.chapterTitle,
      selected_text: input.selectedText,
      preceding_context: input.precedingContext,
      following_context: input.followingContext || '',
      question: input.question,
      history: input.history,
      image_url: imageUrl,
      vision: !!imageUrl,
      answer_format: input.answerFormat || 'notes',
    },
  })

  if (error) {
    throw new Error(await extractFunctionsError(error, data))
  }

  if (data?.error) throw new Error(String(data.error))
  if (typeof data?.answer !== 'string') throw new Error('Boş AI yanıtı')
  // Server should echo vision:true when image was used
  if (input.requireImage && data?.vision !== true) {
    throw new Error(
      'Sunucu grafiği alamadı (eski fonksiyon?). chat-with-chapter’ı yeniden deploy et.',
    )
  }
  return data.answer as string
}

export type PracticeDifficulty = 'easy' | 'medium' | 'hard'

export function practiceDifficultyLabel(d?: PracticeDifficulty | null): string {
  if (d === 'easy') return 'Kolay'
  if (d === 'hard') return 'Zor'
  if (d === 'medium') return 'Orta'
  return ''
}

export async function suggestContribution(input: {
  kind: 'quiz' | 'example' | 'explanation'
  chapterTitle: string
  hint: string
  quizType?: string
  context?: string
  difficulty?: PracticeDifficulty
  count?: number
  avoid?: string[]
}) {
  const { data, error } = await supabase.functions.invoke(
    'suggest-contribution',
    {
      body: {
        kind: input.kind,
        chapter_title: input.chapterTitle,
        hint: input.hint,
        quiz_type: input.quizType || 'mcq',
        context: input.context || '',
        difficulty: input.difficulty || 'medium',
        count: input.count ?? 1,
        avoid: input.avoid ?? [],
      },
    },
  )
  if (error) throw new Error(await extractFunctionsError(error, data))
  if (data?.error) throw new Error(String(data.error))
  if (!data?.payload || typeof data.payload !== 'object') {
    throw new Error('AI öneri boş döndü')
  }
  return data.payload as Record<string, unknown>
}

/** On-demand Alıştır: more quiz / solved examples at a chosen difficulty. */
export async function generateMorePractice(input: {
  kind: 'quiz' | 'example'
  chapterTitle: string
  difficulty: PracticeDifficulty
  count?: number
  context?: string
  avoid?: string[]
}): Promise<{ quiz?: QuizItem[]; examples?: ExampleItem[] }> {
  const count = Math.min(10, Math.max(1, input.count ?? 5))
  const payload = await suggestContribution({
    kind: input.kind,
    chapterTitle: input.chapterTitle,
    hint: `Alıştır genişletme · zorluk ${input.difficulty} · ${count} madde`,
    quizType: 'mcq',
    context: input.context || '',
    difficulty: input.difficulty,
    count,
    avoid: input.avoid,
  })

  const rows: unknown[] = Array.isArray(
    (payload as { items?: unknown }).items,
  )
    ? ((payload as { items: unknown[] }).items)
    : [payload]

  if (input.kind === 'quiz') {
    const quiz = rows
      .map((row) => ({
        ...normalizeQuiz(row as Partial<QuizItem>),
        difficulty: input.difficulty,
      }))
      .filter((q) => q.question.length >= 4)
      .slice(0, count)
    if (!quiz.length) throw new Error('Yeni soru üretilemedi')
    return { quiz }
  }

  const examples = rows
    .map((row) => ({
      ...normalizeExample(row as Partial<ExampleItem>),
      difficulty: input.difficulty,
    }))
    .filter((ex) => ex.problem.length >= 4)
    .slice(0, count)
  if (!examples.length) throw new Error('Yeni örnek üretilemedi')
  return { examples }
}

export function aiUsageOperationLabel(
  op: string,
  meta?: Record<string, unknown> | null,
): string {
  switch (op) {
    case 'chapter_notes': {
      const chunk = Number(meta?.chunk_index)
      const total = Number(meta?.total_chunks)
      if (Number.isFinite(chunk) && Number.isFinite(total) && total > 1) {
        return `Standart anlatım (parça ${chunk + 1}/${total})`
      }
      return 'Standart anlatım'
    }
    case 'artifact_brief':
      return 'Kısa özet'
    case 'artifact_detailed':
      return 'Detaylı anlatım'
    case 'artifact_practice':
      return 'Alıştır (quiz/örnek)'
    case 'artifact_mind_map':
      return 'Zihin haritası'
    case 'chapter_chat':
      return 'Seçim sohbeti'
    case 'segment':
      return 'Ünite segmentasyonu'
    case 'pack':
      return 'Ünite paketleme'
    default:
      return op
  }
}

export type AiUsageTotals = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens: number
  /** prompt_tokens - cached_tokens (approx. billable input) */
  prompt_miss_tokens: number
  events: number
}

/** Recent LLM token events for a book (and optionally one chapter). */
export async function fetchAiUsageEvents(input: {
  bookId: string
  chapterId?: string | null
  /** When true with chapterId, only that chapter. Default: whole book. */
  chapterOnly?: boolean
  limit?: number
}): Promise<{ events: AiUsageEvent[]; totals: AiUsageTotals }> {
  const limit = Math.min(200, Math.max(10, input.limit ?? 80))
  const chapterOnly = !!input.chapterOnly && !!input.chapterId

  // Prefer chapter_id when scoped (survives null book_id on older rows).
  // Book scope: match book_id OR any event for this chapter (safety net).
  let q = supabase
    .from('ai_usage_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (chapterOnly && input.chapterId) {
    q = q.eq('chapter_id', input.chapterId)
  } else if (input.chapterId) {
    q = q.or(
      `book_id.eq.${input.bookId},chapter_id.eq.${input.chapterId}`,
    )
  } else {
    q = q.eq('book_id', input.bookId)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const events = ((data || []) as AiUsageEvent[]).map((e) => ({
    ...e,
    cached_tokens: e.cached_tokens ?? 0,
  }))
  const totals = events.reduce<AiUsageTotals>(
    (acc, e) => {
      const cached = e.cached_tokens || 0
      acc.prompt_tokens += e.prompt_tokens || 0
      acc.completion_tokens += e.completion_tokens || 0
      acc.total_tokens += e.total_tokens || 0
      acc.cached_tokens += cached
      acc.prompt_miss_tokens += Math.max(0, (e.prompt_tokens || 0) - cached)
      acc.events += 1
      return acc
    },
    {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cached_tokens: 0,
      prompt_miss_tokens: 0,
      events: 0,
    },
  )
  return { events, totals }
}

type BundleArtifactResult = {
  kind: ChapterArtifactKind
  ok: boolean
  cached?: boolean
  usage?: {
    prompt_tokens?: number
    cached_tokens?: number
    completion_tokens?: number
  }
  error?: string
}

/**
 * Hybrid Toplu üret:
 * 1) Edge warm phase: notes + detailed (same isolate → detailed Cache Hit, no 546)
 * 2) Client: brief → practice → mind_map (short invokes, should Cache Hit)
 */
export async function generateChapterBundle(input: {
  id: string
  title: string
  style?: string
  forceArtifacts?: boolean
}) {
  const { data, error } = await supabase.functions.invoke(
    'generate-chapter-bundle',
    {
      body: {
        chapter_id: input.id,
        title: input.title,
        style: input.style || undefined,
        force: input.forceArtifacts !== false,
        phase: 'warm',
      },
    },
  )

  if (error) {
    const detail = await extractFunctionsError(error, data)
    await supabase.from('chapters').update({ status: 'failed' }).eq('id', input.id)
    throw new Error(detail)
  }
  if (data?.error) {
    await supabase.from('chapters').update({ status: 'failed' }).eq('id', input.id)
    throw new Error(String(data.error))
  }

  const artifacts: BundleArtifactResult[] = [
    ...((data?.artifacts || []) as BundleArtifactResult[]),
  ]

  const remaining = (data?.remaining_kinds || [
    'brief',
    'practice',
    'mind_map',
  ]) as ChapterArtifactKind[]

  for (const kind of remaining) {
    try {
      const art = await ensureChapterArtifact({
        chapterId: input.id,
        title: input.title,
        kind,
        force: input.forceArtifacts !== false,
      })
      artifacts.push({
        kind,
        ok: true,
        cached: art?.cached,
        usage: (art as { usage?: BundleArtifactResult['usage'] })?.usage,
      })
      await sleep(350)
    } catch (err) {
      artifacts.push({
        kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    notes: {
      usage: data?.notes_usage,
      done: true,
    },
    artifacts,
    prefix_fp: data?.prefix_fp as string | undefined,
    phase: data?.phase as string | undefined,
  }
}
