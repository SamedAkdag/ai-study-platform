export type PageText = {
  pageNumber: number
  text: string
}

export type PageWindow = {
  windowIndex: number
  startPage: number
  endPage: number
  pages: PageText[]
  text: string
}

/** Sliding windows of `size` pages with 1-page overlap (last page of previous window). */
export function buildSlidingWindows(
  pages: PageText[],
  size = 5,
  overlap = 1,
): PageWindow[] {
  if (pages.length === 0) return []
  if (size < 1) throw new Error('Window size must be >= 1')
  if (overlap < 0 || overlap >= size) {
    throw new Error('Overlap must be >= 0 and < window size')
  }

  const step = size - overlap
  const windows: PageWindow[] = []

  for (let start = 0; start < pages.length; start += step) {
    const slice = pages.slice(start, start + size)
    const startPage = slice[0]!.pageNumber
    const endPage = slice[slice.length - 1]!.pageNumber

    windows.push({
      windowIndex: windows.length,
      startPage,
      endPage,
      pages: slice,
      text: slice
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join('\n\n'),
    })

    if (start + size >= pages.length) break
  }

  return windows
}
