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
      // pdf.js çağırmadan önce kaydet + aç — tarayıcı gibi hızlı
      const bookTitle = sanitizeForPostgres(
        title.trim() || file.name.replace(/\.pdf$/i, '') || 'Untitled book',
      )

      setPhase('Kaydediliyor…')
      const created = await createBookRecord({
        title: bookTitle,
        totalPages: 0,
      })
      bookId = created.id

      // Tek kopya → bellek + IndexedDB; okuma sayfası anında URL alsın
      const blob = await cachePdfLocally(bookId, file)
      rememberPdf(bookId, blob)

      await supabase
        .from('books')
        .update({
          subject: subject.trim() || null,
          file_url: `local:${bookId}`,
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
      <section className="mx-auto max-w-2xl space-y-9">
        <header className="fade-up space-y-3 text-center">
          <p className="section-label">Studium</p>
          <h1 className="font-display text-[2.35rem] font-semibold tracking-tight sm:text-4xl">
            PDF’ni aç, hemen çalış
          </h1>
          <p className="muted mx-auto max-w-md text-[0.95rem] leading-relaxed">
            Yükle — PDF saniyeler içinde açılır. Metin arka planda hazırlanır.
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
