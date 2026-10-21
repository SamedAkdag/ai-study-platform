import type { PdfTextStyle } from '@/lib/pdfTextStyle'
import type { PdfRegion } from '@/lib/pdfRegion'

export type PdfSelectionPayload = {
  selectedText: string
  precedingContext: string
  followingContext: string
  page: number
  /** Typography sampled from the selected PDF spans (for style-matched inserts). */
  textStyle?: PdfTextStyle
  /** Selection box on the page (for PDF-style AI insert). */
  region?: PdfRegion
  paperColor?: string
  /**
   * `region` = marquee over a chart/figure (vision).
   * Default / omitted = text selection.
   */
  kind?: 'text' | 'region'
  /** Cropped page region as data URL for MiMo vision. */
  imageDataUrl?: string
}

export type PdfSelectionAction =
  | 'ask'
  | 'summarize'
  | 'explain'
  | 'note'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'replace'
  | 'redact'
  | 'copy'
  | 'omit'
  | 'extract'
  | 'cite'
  | 'bookmark'
