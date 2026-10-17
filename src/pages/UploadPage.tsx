import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cachePdfLocally } from '@/lib/pdfCache'
import { rememberPdf } from '@/lib/pdfSession'
import { startBackgroundBookImport } from '@/lib/bookImport'
import { createBookRecord, markBookFailed } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { sanitizeForPostgres } from '@/lib/sanitize'
import AppShell from '@/components/AppShell'
import LibraryShelf from '@/components/LibraryShelf'

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
    setPhase('Açılıyor…')
    let bookId: string | null = null

    try {
      const bookTitle = sanitizeForPostgres(
        title.trim() || file.name.replace(/\.pdf$/i, '') || 'Untitled book',
      )

      setPhase('Kaydediliyor…')
      const created = await createBookRecord({
        title: bookTitle,
        totalPages: 0,
      })
      bookId = created.id

      const blob = await cachePdfLocally(bookId, file)
      rememberPdf(bookId, blob)

      setPhase('PDF yükleniyor…')
      const { uploadBookPdf } = await import('@/lib/bookPdf')
      const fileUrl = await uploadBookPdf(bookId, file)

      await supabase
        .from('books')
        .update({
          subject: subject.trim() || null,
          file_url: fileUrl,
          progress_step: 'imported',
          status: 'ready',
          error_message: null,
        })
        .eq('id', bookId)

      startBackgroundBookImport({
        bookId,
        file,
        subject: subject.trim() || null,
        titleHint: bookTitle,
      })

      navigate(`/books/${bookId}/read`, { replace: true })
    } catch (err) {
      const msg = formatError(err)
      if (bookId) await markBookFailed(bookId, msg)
      setError(msg)
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <AppShell autoTour>
      <section className="home-compose">
        <header className="home-hero fade-up">
          <h1 className="home-hero__brand">Studium</h1>
          <p className="home-hero__line">PDF’ni aç, hemen çalış.</p>
          <p className="home-hero__sub">
            Yükle — sayfalar saniyeler içinde açılır. Anlatım arka planda hazırlanır.
          </p>
        </header>

        <div className={`home-desk fade-up-delay ${dragging ? 'is-dragging' : ''}`}>
          <div className="home-desk__spine" aria-hidden />
          <div className="home-desk__ruled" aria-hidden />
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
            className={`dropzone dropzone--desk ${dragging ? 'is-dragging' : ''}`}
          >
            <span className="dropzone__kicker">Masaüstü</span>
            <p className="font-display text-xl font-semibold sm:text-2xl">
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

          <details className="home-desk__meta text-sm">
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

          {error && <div className="alert-error mx-5 mb-5 sm:mx-6">{error}</div>}
        </div>

        <section className="home-shelf fade-up-late">
          <div className="home-shelf__head">
            <p className="section-label mb-0">Kitaplık</p>
            <p className="muted text-xs">Raftan devam et</p>
          </div>
          <div className="home-shelf__panel">
            <LibraryShelf />
          </div>
        </section>
      </section>
    </AppShell>
  )
}
