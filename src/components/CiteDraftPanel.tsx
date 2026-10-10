import { useMemo, useState } from 'react'
import {
  CITATION_STYLES,
  formatCitation,
  loadCiteMeta,
  loadCiteStyle,
  saveCiteMeta,
  saveCiteStyle,
  type CitationStyle,
  type CiteSourceMeta,
} from '@/lib/citations'
import type { PdfSelectionPayload } from '@/types/pdfSelection'

type Props = {
  bookId: string
  bookTitle: string
  payload: PdfSelectionPayload
  onCancel: () => void
  onSaved: (formatted: string, style: CitationStyle) => void
}

/** Compact cite composer: style + optional author/year → copy & save. */
export default function CiteDraftPanel({
  bookId,
  bookTitle,
  payload,
  onCancel,
  onSaved,
}: Props) {
  const stored = loadCiteMeta(bookId)
  const [style, setStyle] = useState<CitationStyle>(() => loadCiteStyle())
  const [author, setAuthor] = useState(stored.author || '')
  const [year, setYear] = useState(stored.year || '')
  const [title, setTitle] = useState(stored.title || bookTitle || '')

  const meta: CiteSourceMeta = {
    title: title.trim() || bookTitle || 'Adsız kaynak',
    author: author.trim() || undefined,
    year: year.trim() || undefined,
  }

  const preview = useMemo(
    () =>
      formatCitation({
        title: meta.title,
        author: meta.author,
        year: meta.year,
        quote: payload.selectedText,
        page: payload.page,
        style,
      }),
    [
      meta.title,
      meta.author,
      meta.year,
      payload.selectedText,
      payload.page,
      style,
    ],
  )

  function pickStyle(next: CitationStyle) {
    setStyle(next)
    saveCiteStyle(next)
  }

  function commit() {
    saveCiteMeta(bookId, {
      title: meta.title,
      author: meta.author,
      year: meta.year,
    })
    saveCiteStyle(style)
    void navigator.clipboard?.writeText(preview).catch(() => undefined)
    onSaved(preview, style)
  }

  return (
    <div className="surface-panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="section-label mb-0.5">Cite</p>
          <p className="muted text-[11px]">s. {payload.page}</p>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onCancel}>
          Vazgeç
        </button>
      </div>

      <blockquote className="pdf-ai-panel__quote">
        {payload.selectedText.slice(0, 220)}
        {payload.selectedText.length > 220 ? '…' : ''}
      </blockquote>

      <div className="flex flex-wrap gap-1.5">
        {CITATION_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip ${style === s.id ? 'chip-active' : 'chip-idle'}`}
            onClick={() => pickStyle(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="muted">Yazar</span>
          <input
            className="field mt-1 w-full text-sm"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="örn. Yılmaz"
          />
        </label>
        <label className="block text-xs">
          <span className="muted">Yıl</span>
          <input
            className="field mt-1 w-full text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="örn. 2021"
            inputMode="numeric"
          />
        </label>
      </div>
      <label className="block text-xs">
        <span className="muted">Başlık</span>
        <input
          className="field mt-1 w-full text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Kaynak başlığı"
        />
      </label>

      <pre className="cite-preview">{preview}</pre>

      <button type="button" className="btn-primary w-full text-sm" onClick={commit}>
        Kopyala ve kaydet
      </button>
    </div>
  )
}
