import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deletePages,
  downloadPdfBytes,
  extractPages,
  fetchPdfBytes,
  getPdfPageCount,
  mergePdfs,
  pdfBytesToBlob,
  reorderPages,
  rotatePages,
  watermarkPdf,
} from '@/lib/pdfManipulate'
import { uploadBookPdf } from '@/lib/bookPdf'
import { friendlyAiError } from '@/lib/errors'

type Props = {
  pdfSrc: string
  /** Prefer session bytes when parent already holds a working copy. */
  initialBytes?: Uint8Array | null
  bookId: string
  bookTitle?: string
  /** Live-update viewer after each organize op (same workingBytes pipeline). */
  onBytesChange?: (bytes: Uint8Array) => void
  onSaved?: (blob: Blob) => void
  onClose?: () => void
}

type Busy =
  | null
  | 'load'
  | 'delete'
  | 'extract'
  | 'rotate'
  | 'reorder'
  | 'merge'
  | 'watermark'
  | 'save'

/** Adobe-style page organize: delete / extract / rotate / reorder / merge. */
export default function PdfOrganizePanel({
  pdfSrc,
  initialBytes = null,
  bookId,
  bookTitle = 'PDF',
  onBytesChange,
  onSaved,
  onClose,
}: Props) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [order, setOrder] = useState<number[]>([])
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState<Busy>('load')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setBusy('load')
    setError(null)
    void (async () => {
      try {
        const raw =
          initialBytes && initialBytes.byteLength > 0
            ? initialBytes
            : await fetchPdfBytes(pdfSrc)
        const n = await getPdfPageCount(raw)
        if (cancelled) return
        setBytes(raw)
        setPageCount(n)
        setOrder(Array.from({ length: n }, (_, i) => i + 1))
        setSelected(new Set())
      } catch (err) {
        if (!cancelled) setError(friendlyAiError(err))
      } finally {
        if (!cancelled) setBusy(null)
      }
    })()
    return () => {
      cancelled = true
    }
    // Only re-bootstrap when src changes; live edits come via apply → onBytesChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfSrc])

  const selectedList = useMemo(
    () => [...selected].sort((a, b) => a - b),
    [selected],
  )

  function toggle(page: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(page)) next.delete(page)
      else next.add(page)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(order))
  }

  function clearSel() {
    setSelected(new Set())
  }

  async function apply(
    kind: Exclude<Busy, null | 'load'>,
    fn: (src: Uint8Array) => Promise<Uint8Array>,
    okMsg: string,
  ) {
    if (!bytes || busy) return
    setBusy(kind)
    setError(null)
    setNote(null)
    try {
      const next = await fn(bytes)
      const n = await getPdfPageCount(next)
      setBytes(next)
      setPageCount(n)
      setOrder(Array.from({ length: n }, (_, i) => i + 1))
      setSelected(new Set())
      setNote(okMsg)
      onBytesChange?.(next)
    } catch (err) {
      setError(friendlyAiError(err))
    } finally {
      setBusy(null)
    }
  }

  function moveSelected(dir: -1 | 1) {
    if (!selectedList.length) return
    setOrder((prev) => {
      const next = [...prev]
      const idxs = selectedList
        .map((p) => next.indexOf(p))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)
      if (dir < 0) {
        for (const i of idxs) {
          if (i <= 0) continue
          ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
        }
      } else {
        for (let k = idxs.length - 1; k >= 0; k--) {
          const i = idxs[k]!
          if (i >= next.length - 1) continue
          ;[next[i], next[i + 1]] = [next[i + 1]!, next[i]!]
        }
      }
      return next
    })
  }

  async function commitReorder() {
    await apply(
      'reorder',
      (src) => reorderPages(src, order),
      'Sayfa sırası uygulandı',
    )
  }

  async function saveToBook() {
    if (!bytes || busy) return
    setBusy('save')
    setError(null)
    try {
      const blob = pdfBytesToBlob(bytes)
      const file = new File([blob], `${bookTitle || 'book'}.pdf`, {
        type: 'application/pdf',
      })
      await uploadBookPdf(bookId, file)
      const n = await getPdfPageCount(bytes)
      const { supabase } = await import('@/lib/supabase')
      await supabase
        .from('books')
        .update({ total_pages: n })
        .eq('id', bookId)
      onSaved?.(blob)
      setNote('Kitaba kaydedildi — görüntüleyici yenilendi')
    } catch (err) {
      setError(friendlyAiError(err))
    } finally {
      setBusy(null)
    }
  }

  const disabled = !!busy || !bytes

  return (
    <section className="pdf-organize surface-panel" aria-label="PDF düzenle">
      <header className="pdf-organize__head">
        <div>
          <p className="section-label mb-0">PDF düzenle</p>
          <p className="muted text-[11px] leading-relaxed">
            Sayfa sil · çıkar · döndür · sırala · birleştir
            {pageCount ? ` · ${pageCount} sayfa` : ''}
          </p>
        </div>
        {onClose ? (
          <button type="button" className="btn-ghost text-[11px]" onClick={onClose}>
            Kapat
          </button>
        ) : null}
      </header>

      {busy === 'load' && (
        <p className="muted p-3 text-sm">PDF yükleniyor…</p>
      )}
      {error && <div className="alert-error mx-3 mb-2 text-sm">{error}</div>}
      {note && <div className="alert-info mx-3 mb-2 text-sm">{note}</div>}

      {bytes && (
        <>
          <div className="pdf-organize__toolbar">
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled}
              onClick={selectAll}
            >
              Tümü
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled || !selected.size}
              onClick={clearSel}
            >
              Temizle
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled || !selected.size}
              onClick={() =>
                void apply(
                  'delete',
                  (src) => deletePages(src, selectedList),
                  `${selectedList.length} sayfa silindi`,
                )
              }
            >
              Sil
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled || !selected.size}
              onClick={() =>
                void apply(
                  'extract',
                  async (src) => {
                    const part = await extractPages(src, selectedList)
                    downloadPdfBytes(
                      part,
                      `${slug(bookTitle)}-s${selectedList[0]}-${selectedList[selectedList.length - 1]}`,
                    )
                    return src
                  },
                  'Seçilen sayfalar indirildi',
                )
              }
            >
              Çıkar
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled || !selected.size}
              onClick={() =>
                void apply(
                  'rotate',
                  (src) => rotatePages(src, selectedList, 90),
                  '90° döndürüldü',
                )
              }
            >
              ↻ 90°
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled || selectedList.length < 1}
              onClick={() => moveSelected(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled || selectedList.length < 1}
              onClick={() => moveSelected(1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled}
              onClick={() => void commitReorder()}
            >
              Sırayı uygula
            </button>
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              Birleştir…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file || !bytes) return
                void apply(
                  'merge',
                  async (src) => {
                    const extra = new Uint8Array(await file.arrayBuffer())
                    return mergePdfs(src, [extra])
                  },
                  `"${file.name}" eklendi`,
                )
              }}
            />
            <button
              type="button"
              className="chip chip-idle"
              disabled={disabled}
              onClick={() =>
                void apply(
                  'watermark',
                  (src) => watermarkPdf(src, 'Studium'),
                  'Filigran eklendi',
                )
              }
            >
              Filigran
            </button>
          </div>

          <ul className="pdf-organize__pages">
            {order.map((page, idx) => (
              <li key={`${page}-${idx}`}>
                <label className="pdf-organize__page">
                  <input
                    type="checkbox"
                    checked={selected.has(page)}
                    onChange={() => toggle(page)}
                    disabled={disabled}
                  />
                  <span className="pdf-organize__page-idx">{idx + 1}.</span>
                  <span>Sayfa {page}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="pdf-organize__actions">
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={disabled}
              onClick={() => void saveToBook()}
            >
              {busy === 'save' ? 'Kaydediliyor…' : 'Kitaba kaydet'}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={disabled}
              onClick={() => {
                if (!bytes) return
                downloadPdfBytes(bytes, `${slug(bookTitle)}-duzenli`)
                setNote('PDF indirildi')
              }}
            >
              İndir
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function slug(s: string) {
  return (
    s
      .toLocaleLowerCase('tr')
      .replace(/[^a-z0-9çğıöşü]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'studium'
  )
}
