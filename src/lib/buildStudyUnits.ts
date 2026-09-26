import type { PageText } from './slidingWindow'
import type { MergedChapter } from './mergeChapters'

const TARGET = 5
const MAX = 7

/**
 * Build study units locally (~5 pages).
 * Titles/summaries are upgraded by AI in nameStudyUnits() after this step.
 */
export function buildStudyUnitsFromPages(pages: PageText[]): MergedChapter[] {
  if (pages.length === 0) return []

  const units: MergedChapter[] = []
  let i = 0

  while (i < pages.length) {
    const start = pages[i]!
    let endIndex = Math.min(i + TARGET - 1, pages.length - 1)

    // If the target end page has almost no text, extend a bit to gather more context
    while (
      endIndex < pages.length - 1 &&
      endIndex - i + 1 < MAX &&
      pages[endIndex]!.text.replace(/\s+/g, '').length < 40
    ) {
      endIndex += 1
    }

    const slice = pages.slice(i, endIndex + 1)
    const startPage = slice[0]!.pageNumber
    const endPage = slice[slice.length - 1]!.pageNumber
    const title = inferTitle(slice, startPage, endPage)
    const concepts = inferKeyConcepts(slice)

    units.push({
      chapter_number: units.length + 1,
      title,
      start_page: startPage,
      end_page: endPage,
      summary: `Sayfa ${startPage}–${endPage} çalışma ünitesi`,
      key_concepts: concepts,
    })

    i = endIndex + 1
  }

  return units
}

function inferTitle(pages: PageText[], startPage: number, endPage: number): string {
  return `Konu çalışması (s. ${startPage}–${endPage})`
}

function inferKeyConcepts(pages: PageText[]): string[] {
  const text = pages.map((p) => p.text).join(' ')
  const words = text
    .split(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/)
    .filter((w) => w.length > 5)
  const freq = new Map<string, number>()
  for (const w of words) {
    const key = w.toLowerCase()
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w)
}
