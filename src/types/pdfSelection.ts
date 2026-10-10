export type PdfSelectionPayload = {
  selectedText: string
  precedingContext: string
  followingContext: string
  page: number
}

export type PdfSelectionAction =
  | 'ask'
  | 'summarize'
  | 'explain'
  | 'note'
  | 'highlight'
  | 'omit'
  | 'extract'
  | 'cite'
  | 'bookmark'
