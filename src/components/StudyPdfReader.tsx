import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useTextSelection,
} from '@/hooks/useTextSelection'
import {
  formatPageAsStudyProse,
  looksLikeBrokenTwoColumnLayout,
} from '@/lib/formatPdfProse'
import {
  extractPageColumnMarkdown,
  isFragmentedColumnMarkdown,
} from '@/lib/pdf'
import type { PageText } from '@/lib/slidingWindow'
import type { PdfSelectionAction, PdfSelectionPayload } from '@/types/pdfSelection'
import SelectionActionBar from '@/components/SelectionActionBar'
import StudyMarkdown from '@/components/StudyMarkdown'
import PdfPagePreview, { stripImageNotices } from '@/components/PdfPagePreview'
import PdfViewer from '@/components/PdfViewer'
import PageJumpControl from '@/components/PageJumpControl'

type Props = {
  pages: PageText[]
  totalPages?: number
  bookTitle?: string
  startPage?: number
  endPage?: number
  page?: number
  onPageChange?: (page: number) => void
  pdfSrc?: string | null
  loadingMore?: boolean
  omittedQuotes?: string[]
  highlightedQuotes?: string[]
  onAction?: (payload: PdfSelectionPayload, action: PdfSelectionAction) => void
  className?: string
}

type TextPoint = { node: Text; offset: number }

function collectTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n.textContent) nodes.push(n as Text)
  }
  return nodes
}

/** DOM metninde (normalize boşluk) needle bul → gerçek Text noktaları. */
function findQuoteRange(
  root: HTMLElement,
  quote: string,
): { start: TextPoint; end: TextPoint } | null {
  const needle = quote.replace(/\s+/g, ' ').trim()
  if (needle.length < 3) return null

  const nodes = collectTextNodes(root)
  if (!nodes.length) return null

  // Normalize map: flatNorm[i] ↔ (node, offset in node)
  let flat = ''
  const map: Array<{ node: Text; offset: number }> = []

  for (const node of nodes) {
    const raw = node.textContent || ''
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i]!
      if (/\s/.test(ch)) {
        if (!flat || flat.endsWith(' ')) continue
        flat += ' '
        map.push({ node, offset: i })
      } else {
        flat += ch
        map.push({ node, offset: i })
      }
    }
  }

  const startIdx = flat.indexOf(needle)
  if (startIdx < 0) {
    // kısmi eşleşme: ilk 80 karakter
    const short = needle.slice(0, Math.min(80, needle.length))
    if (short.length < 4) return null
    const alt = flat.indexOf(short)
    if (alt < 0) return null
    const endGuess = Math.min(alt + needle.length, flat.length)
    const a = map[alt]
    const b = map[Math.min(endGuess - 1, map.length - 1)]
    if (!a || !b) return null
    return {
      start: { node: a.node, offset: a.offset },
      end: { node: b.node, offset: b.offset + 1 },
    }
  }

  const endIdx = startIdx + needle.length - 1
  const a = map[startIdx]
  const b = map[endIdx]
  if (!a || !b) return null
  return {
    start: { node: a.node, offset: a.offset },
    end: { node: b.node, offset: b.offset + 1 },
  }
}

function wrapRangeWithSpan(
  start: TextPoint,
  end: TextPoint,
  className: string,
) {
  const range = document.createRange()
  try {
    range.setStart(start.node, Math.min(start.offset, start.node.length))
    range.setEnd(end.node, Math.min(end.offset, end.node.length))
  } catch {
    return
  }

  const span = document.createElement('span')
  span.className = className

  try {
    range.surroundContents(span)
  } catch {
    // Çoklu düğüm: extractContents
    try {
      const frag = range.extractContents()
      span.appendChild(frag)
      range.insertNode(span)
    } catch {
      /* ignore */
    }
  }
}

function markQuotes(
  root: HTMLElement,
  quotes: string[],
  className: string,
) {
  for (const q of quotes) {
    const found = findQuoteRange(root, q)
    if (!found) continue
    wrapRangeWithSpan(found.start, found.end, className)
  }
}

/** Çıkarılan alıntıları metinden tamamen sil. */
function applyOmissions(md: string, quotes: string[]): string {
  let out = md
  for (const q of quotes) {
    const needle = q.replace(/\s+/g, ' ').trim()
    if (needle.length < 3) continue
    const parts = needle.split(/\s+/).filter(Boolean)
    if (!parts.length) continue
    const pattern = parts
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')
    try {
      out = out.replace(new RegExp(pattern, 'gi'), '')
    } catch {
      /* ignore bad pattern */
    }
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Görsel ağırlıklı / boş sayfa — metin yoksa sayfa görseli. */
export function isStudiumPageUnusable(raw: string | undefined, markdown: string): boolean {
  const md = (markdown || '').trim()
  if (!md) return true
  const rawT = (raw || '').replace(/\s+/g, ' ').trim()
  if (/görsel ağırlıklı/i.test(rawT)) return true
  const alnum = (md.match(/[A-Za-zÇĞİÖŞÜçğıöşü0-9]/g) || []).length
  if (alnum < 40 && /görsel/i.test(rawT)) return true
  return false
}

/** PDF metni → görsel Studium markdown (ders kitabı stili). */
export default function StudyPdfReader({
  pages,
  totalPages,
  bookTitle,
  startPage,
  endPage,
  page: pageProp,
  onPageChange,
  pdfSrc,
  loadingMore = false,
  omittedQuotes = [],
  highlightedQuotes = [],
  onAction,
  className = '',
}: Props) {
  const sorted = useMemo(
    () => [...pages].sort((a, b) => a.pageNumber - b.pageNumber),
    [pages],
  )
  const minPage = startPage ?? 1
  const maxPage = Math.max(
    endPage ?? 0,
    totalPages ?? 0,
    sorted[sorted.length - 1]?.pageNumber ?? minPage,
    minPage,
  )

  const controlled = typeof pageProp === 'number'
  const [pageInternal, setPageInternal] = useState(pageProp ?? minPage)
  const page = controlled ? pageProp : pageInternal

  function setPage(next: number | ((p: number) => number)) {
    const value = typeof next === 'function' ? next(page) : next
    const clamped = Math.min(Math.max(value, minPage), maxPage)
    if (!controlled) setPageInternal(clamped)
    onPageChange?.(clamped)
  }

  const articleRef = useRef<HTMLElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mdHostRef = useRef<HTMLDivElement>(null)

  // Select only body prose — not page title / repair hints
  const { ctx: selection, clear: clearSelection, hold, snapshot } =
    useTextSelection(mdHostRef)

  useEffect(() => {
    if (controlled) return
    setPageInternal((p) => Math.min(Math.max(p, minPage), maxPage))
  }, [minPage, maxPage, controlled])

  const current = sorted.find((p) => p.pageNumber === page)
  const pageReady = current !== undefined

  const { markdown, showPageImage } = useMemo(() => {
    const formatted = formatPageAsStudyProse(current?.text || '')
    const fromRaw = stripImageNotices(current?.text || '')
    const fromMd = stripImageNotices(formatted)
    const hadNotice =
      fromRaw.hadImageNotice ||
      fromMd.hadImageNotice ||
      /görsel\s+var/i.test(current?.text || '')
    const withoutOmit = applyOmissions(fromMd.cleaned, omittedQuotes)
    return {
      markdown: withoutOmit,
      showPageImage: hadNotice && !!pdfSrc,
    }
  }, [current?.text, pdfSrc, omittedQuotes])

  const brokenTwoColumn =
    pageReady && looksLikeBrokenTwoColumnLayout(current?.text || '')

  /** Cache bozuk iki sütun → pdf.js ile sütun sütun (alt alta) yeniden oku */
  const [columnRepair, setColumnRepair] = useState<{
    page: number
    markdown: string
  } | null>(null)
  const [columnRepairBusy, setColumnRepairBusy] = useState(false)

  useEffect(() => {
    if (!brokenTwoColumn || !pdfSrc || !pageReady) {
      setColumnRepair(null)
      setColumnRepairBusy(false)
      return
    }
    let cancelled = false
    setColumnRepairBusy(true)
    void (async () => {
      const md = await extractPageColumnMarkdown(pdfSrc, page)
      if (cancelled) return
      setColumnRepairBusy(false)
      if (!md || md.replace(/\s+/g, '').length < 40) {
        setColumnRepair(null)
        return
      }
      // Görsel kliip — olduğu gibi; metinse formatla ama parçalı başlığı reddet
      const isImage = /^!\[[^\]]*\]\(\s*data:image\//.test(md.trim())
      if (isImage) {
        setColumnRepair({ page, markdown: md.trim() })
        return
      }
      if (isFragmentedColumnMarkdown(md)) {
        setColumnRepair(null)
        return
      }
      const formatted = formatPageAsStudyProse(md)
      if (isFragmentedColumnMarkdown(formatted)) {
        setColumnRepair(null)
        return
      }
      setColumnRepair({ page, markdown: formatted })
    })()
    return () => {
      cancelled = true
    }
  }, [brokenTwoColumn, pdfSrc, page, pageReady])

  const repairedMd =
    columnRepair && columnRepair.page === page ? columnRepair.markdown : null

  const displayMarkdown = repairedMd
    ? applyOmissions(repairedMd, omittedQuotes)
    : markdown

  const showOriginalFallback =
    pageReady &&
    !!pdfSrc &&
    isStudiumPageUnusable(current?.text, markdown) &&
    !repairedMd

  useEffect(() => {
    const host = mdHostRef.current
    if (!host || !displayMarkdown || showOriginalFallback) return
    markQuotes(host, highlightedQuotes, 'study-pdf-hi')
  }, [displayMarkdown, page, highlightedQuotes, showOriginalFallback])

  function fire(action: PdfSelectionAction) {
    const snap = snapshot()
    if (!snap?.selectedText.trim() || !onAction) return
    onAction(
      {
        selectedText: snap.selectedText,
        precedingContext: snap.precedingContext,
        followingContext: snap.followingContext,
        page,
      },
      action,
    )
    clearSelection()
  }

  const toolbar =
    selection && onAction && !showOriginalFallback ? (
      <SelectionActionBar
        preview={selection.selectedText}
        hold={hold}
        onAction={fire}
        style={{
          position: 'absolute',
          top: Math.max(
            8,
            selection.rect.bottom -
              (wrapRef.current?.getBoundingClientRect().top ?? 0) +
              (wrapRef.current?.scrollTop ?? 0) +
              6,
          ),
          left: Math.max(
            8,
            selection.rect.left -
              (wrapRef.current?.getBoundingClientRect().left ?? 0) +
              (wrapRef.current?.scrollLeft ?? 0),
          ),
          zIndex: 30,
        }}
      />
    ) : null

  const pager = (
    <div className="study-pdf-pager" aria-label="Sayfa">
      <button
        type="button"
        className="study-pdf-pager__btn"
        disabled={page <= minPage}
        onClick={() => setPage(page - 1)}
        aria-label="Önceki sayfa"
      >
        ‹
      </button>
      <PageJumpControl
        page={page}
        minPage={minPage}
        maxPage={maxPage}
        loadingHint={loadingMore}
        onJump={setPage}
      />
      <button
        type="button"
        className="study-pdf-pager__btn"
        disabled={page >= maxPage}
        onClick={() => setPage(page + 1)}
        aria-label="Sonraki sayfa"
      >
        ›
      </button>
    </div>
  )

  return (
    <div className={`study-pdf-reader ${className}`}>
      {pager}

      <div ref={wrapRef} className="study-pdf-reader__scroll">
        {!pageReady ? (
          <article className="study-pdf-page">
            {bookTitle ? (
              <p className="study-pdf-page__title">{bookTitle}</p>
            ) : null}
            <div className="study-callout mt-4">
              <strong>Sayfa hazırlanıyor…</strong> Metin arka planda okunuyor;
              birkaç saniye içinde burada görünecek.
            </div>
          </article>
        ) : showOriginalFallback && pdfSrc ? (
          <article className="study-pdf-page study-pdf-page--preview-only">
            {bookTitle ? (
              <p className="study-pdf-page__title">{bookTitle}</p>
            ) : null}
            <PdfPagePreview src={pdfSrc} pageNumber={page} />
          </article>
        ) : brokenTwoColumn &&
          !columnRepairBusy &&
          !repairedMd &&
          pdfSrc ? (
          <article className="study-pdf-page study-pdf-page--preview-only">
            {bookTitle ? (
              <p className="study-pdf-page__title">{bookTitle}</p>
            ) : null}
            <p className="study-pdf-col-fallback__hint muted">
              İki sütun düzeni güvenli metne çevrilemedi; orijinal sayfa
              gösteriliyor.
            </p>
            <PdfViewer
              src={pdfSrc}
              page={page}
              onPageChange={onPageChange}
              hideChrome
              className="study-pdf-col-fallback__viewer"
            />
          </article>
        ) : (
          <article ref={articleRef} className="study-pdf-page">
            {bookTitle ? (
              <p className="study-pdf-page__title">{bookTitle}</p>
            ) : null}
            {brokenTwoColumn && columnRepairBusy && !repairedMd ? (
              <p className="muted text-sm" style={{ marginBottom: '0.75rem' }}>
                İki sütun düzeni okunuyor…
              </p>
            ) : null}
            {repairedMd ? (
              <p className="study-pdf-col-fallback__hint muted">
                {/^!\[[^\]]*\]\(\s*data:image\//.test(repairedMd.trim())
                  ? 'Yan yana sütun bölgesi görsel olarak korundu.'
                  : 'Yan yana sütunlar alt alta bölüm olarak düzenlendi.'}
              </p>
            ) : null}
            {displayMarkdown && (!brokenTwoColumn || repairedMd) ? (
              <div ref={mdHostRef} className="study-pdf-page__body">
                <StudyMarkdown markdown={displayMarkdown} />
              </div>
            ) : null}
            {showPageImage && pdfSrc && !brokenTwoColumn ? (
              <PdfPagePreview
                src={pdfSrc}
                pageNumber={page}
                className="study-pdf-page__figure"
              />
            ) : null}
          </article>
        )}
        {toolbar}
      </div>
    </div>
  )
}
