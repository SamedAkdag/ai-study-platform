import { segmentStudyUnits } from '@/lib/segmentStudyUnits'
import { markBookReady, saveChapters } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { loadCachedPageTexts, loadCachedPdf } from '@/lib/pdfCache'
import { extractPdfText } from '@/lib/pdf'
import type { PageText } from '@/lib/slidingWindow'

/** Optional late unit segmentation — runs after the user already has the PDF open. */
export async function processBookPipeline(input: {
  bookId: string
  bookTitle: string
  pages?: PageText[]
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

  await supabase
    .from('books')
    .update({
      progress_step: 'analyzing',
      status: 'processing',
      error_message: null,
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
          error_message: p.message.slice(0, 1500),
        })
        .eq('id', bookId)
    },
  })

  await supabase
    .from('books')
    .update({ progress_step: 'saving', error_message: null })
    .eq('id', bookId)

  await saveChapters(bookId, units, pages)
  await markBookReady(bookId)
}
