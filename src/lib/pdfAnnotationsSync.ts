import { supabase } from './supabase'
import { currentUserId } from './authSession'
import type { PdfAnnotation } from './pdfAnnotations'
import { loadPdfAnnotations, savePdfAnnotations } from './pdfAnnotations'

function rowToLocal(
  row: {
    id: string
    book_id: string
    page: number
    kind: string
    quote: string
    body: string | null
    cite_style: string | null
    ai_mode: string | null
    question: string | null
    anchor_top_pct: number | null
    anchor_left_pct: number | null
    created_at: string
  },
): PdfAnnotation {
  return {
    id: row.id,
    bookId: row.book_id,
    page: row.page,
    kind: row.kind as PdfAnnotation['kind'],
    quote: row.quote || '',
    body: row.body || undefined,
    citeStyle: row.cite_style || undefined,
    aiMode: (row.ai_mode as PdfAnnotation['aiMode']) || undefined,
    question: row.question || undefined,
    anchorTopPct: row.anchor_top_pct ?? undefined,
    anchorLeftPct: row.anchor_left_pct ?? undefined,
    createdAt: row.created_at,
  }
}

/** Push one annotation to Supabase (signed-in). */
export async function pushPdfAnnotation(item: PdfAnnotation): Promise<void> {
  try {
    const userId = await currentUserId()
    if (!userId) return
    const { error } = await supabase.from('pdf_annotations').upsert({
      id: item.id,
      user_id: userId,
      book_id: item.bookId,
      page: item.page,
      kind: item.kind,
      quote: item.quote,
      body: item.body ?? null,
      cite_style: item.citeStyle ?? null,
      ai_mode: item.aiMode ?? null,
      question: item.question ?? null,
      anchor_top_pct: item.anchorTopPct ?? null,
      anchor_left_pct: item.anchorLeftPct ?? null,
      created_at: item.createdAt,
    })
    if (error) console.warn('pdf_annotations upsert failed', error)
  } catch (err) {
    console.warn('pdf_annotations push failed', err)
  }
}

export async function removePdfAnnotationRemote(
  bookId: string,
  id: string,
): Promise<void> {
  try {
    const userId = await currentUserId()
    if (!userId) return
    const { error } = await supabase
      .from('pdf_annotations')
      .delete()
      .eq('id', id)
      .eq('book_id', bookId)
      .eq('user_id', userId)
    if (error) console.warn('pdf_annotations delete failed', error)
  } catch (err) {
    console.warn('pdf_annotations delete failed', err)
  }
}

/**
 * Merge remote annotations into local cache (by id). Returns merged list.
 */
export async function pullPdfAnnotations(
  bookId: string,
): Promise<PdfAnnotation[]> {
  const local = loadPdfAnnotations(bookId)
  try {
    const userId = await currentUserId()
    if (!userId) return local

    const { data, error } = await supabase
      .from('pdf_annotations')
      .select('*')
      .eq('book_id', bookId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(400)

    if (error || !data?.length) {
      if (error) console.warn('pdf_annotations pull failed', error)
      // Push local-only items up once signed in
      if (!error && local.length) {
        for (const item of local.slice(0, 80)) {
          void pushPdfAnnotation(item)
        }
      }
      return local
    }

    const byId = new Map<string, PdfAnnotation>()
    for (const item of local) byId.set(item.id, item)
    for (const row of data) {
      const remote = rowToLocal(row)
      const prev = byId.get(remote.id)
      if (!prev || remote.createdAt >= prev.createdAt) {
        byId.set(remote.id, remote)
      }
    }
    const merged = [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
    savePdfAnnotations(bookId, merged)

    // Upload any local-only ids
    const remoteIds = new Set(data.map((r) => r.id))
    for (const item of local) {
      if (!remoteIds.has(item.id)) void pushPdfAnnotation(item)
    }

    return merged
  } catch {
    return local
  }
}
