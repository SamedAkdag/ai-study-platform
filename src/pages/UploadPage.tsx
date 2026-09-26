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

export default function UploadPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    let bookId: string | null = null

    try {
      const extracted = await extractPdfText(file)
      const bookTitle = title.trim() || extracted.title

      const created = await createBookRecord({
        title: bookTitle,
        totalPages: extracted.totalPages,
      })
      const currentBookId = created.id
      bookId = currentBookId

      await supabase
        .from('books')
        .update({
          subject: subject.trim() || null,
          progress_step: 'extracting',
          status: 'processing',
          error_message: null,
        })
        .eq('id', currentBookId)

      navigate(`/processing/${currentBookId}`, { replace: true })

      await supabase
        .from('books')
        .update({ progress_step: 'analyzing' })
        .eq('id', currentBookId)

      await supabase
        .from('books')
        .update({ progress_step: 'segmenting' })
        .eq('id', currentBookId)

      const units = await segmentStudyUnits({
        bookTitle,
        pages: extracted.pages,
      })

      await supabase
        .from('books')
        .update({ progress_step: 'saving' })
        .eq('id', currentBookId)

      await saveChapters(currentBookId, units, extracted.pages)
      await markBookReady(currentBookId)
      navigate(`/books/${currentBookId}`, { replace: true })
    } catch (err) {
      const msg = formatError(err)
      if (bookId) await markBookFailed(bookId, msg)
      setError(msg)
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-3xl">
        <header className="fade-up mb-10 text-center">
          <p
            className="mb-3 text-xs font-semibold tracking-[0.22em] uppercase"
            style={{ color: 'var(--accent)' }}
          >
            Studium
          </p>
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Upload your textbook.
            <br />
            <span style={{ color: 'var(--accent-deep)' }}>Study smarter.</span>
          </h1>
          <p className="muted fade-up-delay mx-auto mt-4 max-w-xl text-base sm:text-lg">
            PDF tarayıcıda okunur. Konu bütünlüğüne göre üniteler çıkarılır;
            içerik yalnızca seçtiğin ünitede üretilir.
          </p>
        </header>

        <div className="fade-up-delay surface-panel space-y-5 p-5 sm:p-7">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="muted mb-1.5 block font-medium">Kitap adı</span>
              <input
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn. Calculus I"
              />
            </label>
            <label className="block text-sm">
              <span className="muted mb-1.5 block font-medium">Alan</span>
              <select
                className="field"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">Seç…</option>
                <option value="Math">Matematik</option>
                <option value="Physics">Fizik</option>
                <option value="History">Tarih</option>
                <option value="Law">Hukuk / Maliye</option>
                <option value="Other">Diğer</option>
              </select>
            </label>
          </div>

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
              {busy ? 'İşleniyor…' : 'PDF sürükle veya seç'}
            </p>
            <p className="muted text-sm">.pdf · en fazla {MAX_MB}MB · tarayıcıda okunur</p>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {error && <div className="alert-error">{error}</div>}
        </div>
      </section>
    </AppShell>
  )
}
