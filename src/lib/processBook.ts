import { segmentStudyUnits } from '@/lib/segmentStudyUnits'
import { fetchChapters, markBookReady, saveChapters } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { loadCachedPageTexts, loadCachedPdf } from '@/lib/pdfCache'
import { extractPdfText } from '@/lib/pdf'
import type { PageText } from '@/lib/slidingWindow'
import {
  describeUnitScope,
  normalizeUnitScope,
  type UnitScope,
} from '@/lib/unitScope'

/** Optional late unit segmentation — runs after the user already has the PDF open. */
export async function processBookPipeline(input: {
  bookId: string
  bookTitle: string
  pages?: PageText[]
  /** Whole book (default) or a page range the user picked */
  scope?: UnitScope | null
}) {
  const { bookId, bookTitle } = input
  let pages = input.pages

  if (!pages?.length) {
    pages = (await loadCachedPageTexts(bookId)) ?? undefined
  }

  if (!pages?.length) {
    const blob = await loadCachedPdf(bookId)
    if (!blob) {
      throw new Error(
        'Bu cihazda PDF metni yok. PDF’yi yeniden yükle, sonra konuları oluştur.',
      )
    }
    const file = new File([blob], `${bookTitle}.pdf`, {
      type: 'application/pdf',
    })
    const extracted = await extractPdfText(file)
    pages = extracted.pages
  }

  const maxPage = Math.max(0, ...pages.map((p) => p.pageNumber), 0)
  const range = normalizeUnitScope(input.scope ?? null, maxPage)
  if (range) {
    pages = pages.filter(
      (p) => p.pageNumber >= range.from && p.pageNumber <= range.to,
    )
    if (pages.length < 1) {
      throw new Error(
        `Seçilen aralıkta sayfa yok (${range.from}–${range.to}).`,
      )
    }
  }

  const existing = await fetchChapters(bookId)
  const orderOffset = existing.length
    ? Math.max(...existing.map((c) => c.chapter_number || c.order_index || 0), 0)
    : 0

  const scopeLabel = describeUnitScope(
    range ? { mode: 'range', from: range.from, to: range.to } : { mode: 'all' },
    maxPage,
  )

  await supabase
    .from('books')
    .update({
      progress_step: 'analyzing',
      status: 'processing',
      error_message: `${scopeLabel} · hazırlanıyor`.slice(0, 1500),
    })
    .eq('id', bookId)

  await supabase
    .from('books')
    .update({ progress_step: 'segmenting' })
    .eq('id', bookId)

  const units = await segmentStudyUnits({
    bookTitle,
    pages,
    onProgress: async (p) => {
      await supabase
        .from('books')
        .update({
          progress_step: 'segmenting',
          error_message: `${scopeLabel} · ${p.message}`.slice(0, 1500),
        })
        .eq('id', bookId)
    },
  })

  const numbered = units.map((u, i) => ({
    ...u,
    chapter_number: orderOffset + i + 1,
  }))

  await supabase
    .from('books')
    .update({ progress_step: 'saving', error_message: null })
    .eq('id', bookId)

  // Pass full cached pages for page_text assembly when possible
  const allPages =
    (await loadCachedPageTexts(bookId)) ?? pages
  await saveChapters(bookId, numbered, allPages)
  await markBookReady(bookId)
}
