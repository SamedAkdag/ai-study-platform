import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { extractPdfText } from '@/lib/pdf'
import { segmentStudyUnits } from '@/lib/segmentStudyUnits'
import {
  createBookRecord,
  markBookFailed,
  markBookReady,
  saveChapters,
} from '@/lib/api'
import { supabase } from '@/lib/supabase'
import AppShell from '@/components/AppShell'
import LibraryShelf from '@/components/LibraryShelf'
import type { PageText } from '@/lib/slidingWindow'

const MAX_MB = 50

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    if (typeof o.message === 'string' && o.message.trim()) return o.message
  }
  return 'Bilinmeyen hata'
}

/** Runs outside the React tree so navigate/unmount cannot kill the pipeline. */
async function processBookPipeline(input: {
  bookId: string
  bookTitle: string
  pages: PageText[]
}) {
  const { bookId, bookTitle, pages } = input

  await supabase
    .from('books')
    .update({ progress_step: 'analyzing', status: 'processing' })
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
          progress_step: p.phase === 'error' ? 'segmenting' : 'segmenting',
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

export default function UploadPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file || busy) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Sadece PDF yükleyebilirsin.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Maksimum ${MAX_MB}MB.`)
      return
    }

    setBusy(true)
    setError(null)
    setPhase('PDF okunuyor…')
    let bookId: string | null = null

    try {
      const extracted = await extractPdfText(file)
      const bookTitle = title.trim() || extracted.title

      setPhase('Kitap kaydı oluşturuluyor…')
      const created = await createBookRecord({
        title: bookTitle,
        totalPages: extracted.totalPages,
      })
      bookId = created.id

      await supabase
        .from('books')
        .update({
          subject: subject.trim() || null,
          progress_step: 'extracting',
          status: 'processing',
          error_message: null,
        })
        .eq('id', bookId)

      navigate(`/processing/${bookId}`, { replace: true })

      await processBookPipeline({
        bookId,
        bookTitle,
        pages: extracted.pages,
      })

      navigate(`/books/${bookId}`, { replace: true })
    } catch (err) {
      const msg = formatError(err)
      if (bookId) await markBookFailed(bookId, msg)
      setError(msg)
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-2xl space-y-9">
        <header className="fade-up space-y-3 text-center">
          <p className="section-label">Studium</p>
          <h1 className="font-display text-[2.35rem] font-semibold tracking-tight sm:text-4xl">
            PDF yükle, çalışmaya başla
          </h1>
          <p className="muted mx-auto max-w-sm text-[0.95rem] leading-relaxed">
            Bir dosya seç. Üniteler hazır olunca listeden açıp oku.
          </p>
        </header>

        <div className="fade-up-delay surface-panel space-y-4 p-5 sm:p-6">
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void handleFile(e.dataTransfer.files?.[0] ?? null)
            }}
            className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          >
            <p className="font-display text-xl font-semibold">
              {busy ? phase || 'İşleniyor…' : 'PDF’yi buraya bırak'}
            </p>
            <p className="muted text-sm">veya tıkla · en fazla {MAX_MB}MB</p>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <details className="text-sm">
            <summary className="muted cursor-pointer select-none text-xs font-semibold">
              İsteğe bağlı: ad ve alan
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Kitap adı"
              />
              <select
                className="field"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">Alan…</option>
                <option value="Math">Matematik</option>
                <option value="Physics">Fizik</option>
                <option value="History">Tarih</option>
                <option value="Law">Hukuk / Maliye</option>
                <option value="Other">Diğer</option>
              </select>
            </div>
          </details>

          {error && <div className="alert-error">{error}</div>}
        </div>

        <section className="fade-up-delay space-y-2">
          <p className="section-label">Kitaplık</p>
          <div className="surface-panel px-5 py-2 sm:px-6">
            <LibraryShelf />
          </div>
        </section>
      </section>
    </AppShell>
  )
}
