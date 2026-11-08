import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cachePdfLocally } from '@/lib/pdfCache'
import { rememberPdf } from '@/lib/pdfSession'
import { startBackgroundBookImport } from '@/lib/bookImport'
import { createBookRecord, markBookFailed } from '@/lib/api'
import { rememberLibraryBook } from '@/lib/library'
import { supabase } from '@/lib/supabase'
import { sanitizeForPostgres } from '@/lib/sanitize'
import WorkspaceShell from '@/components/WorkspaceShell'
import {
  UPLOAD_ACCEPT,
  isSupportedUpload,
  normalizeUploadToPdf,
} from '@/lib/normalizeUploadFile'
import { friendlyAiError } from '@/lib/errors'

const MAX_MB = 50

/** Dumb-proof home: one CTA, one sentence, two optional fields. */
export default function UploadPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file || busy) return
    if (!isSupportedUpload(file)) {
      setError('PDF, Word, görsel veya metin yükle.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Maksimum ${MAX_MB}MB.`)
      return
    }

    setBusy(true)
    setError(null)
    setPhase('Hazırlanıyor…')
    let bookId: string | null = null

    try {
      const bookTitle = sanitizeForPostgres(
        title.trim() ||
          file.name.replace(/\.[^.]+$/i, '') ||
          'Untitled book',
      )

      const { pdf, truncated } = await normalizeUploadToPdf(file)
      if (truncated) {
        try {
          sessionStorage.setItem(
            'studium_upload_warn',
            'Uzun metin kısaltıldı. Tam içerik için PDF yükle.',
          )
        } catch {
          /* ignore */
        }
      }

      setPhase('Kaydediliyor…')
      const created = await createBookRecord({
        title: bookTitle,
        totalPages: 0,
      })
      bookId = created.id

      const blob = await cachePdfLocally(bookId, pdf)
      rememberPdf(bookId, blob)

      setPhase('Yükleniyor…')
      const { uploadBookPdf } = await import('@/lib/bookPdf')
      const fileUrl = await uploadBookPdf(bookId, pdf)

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

      rememberLibraryBook({
        bookId,
        title: bookTitle,
        subject: subject.trim() || null,
        source: 'mine',
      })

      startBackgroundBookImport({
        bookId,
        file: pdf,
        subject: subject.trim() || null,
        titleHint: bookTitle,
      })

      navigate(`/processing/${bookId}?next=study`, { replace: true })
    } catch (err) {
      const msg = friendlyAiError(err)
      if (bookId) await markBookFailed(bookId, msg).catch(() => {})
      setError(msg)
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <WorkspaceShell crumb="Yükle" autoTour>
      <div className="upload-hero">
        <p className="upload-hero__lead">
          PDF’ini yükle, Studium özet, zihin haritası, kart ve test hazırlasın.
        </p>

        <button
          type="button"
          className="upload-hero__cta"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <span className="upload-hero__cta-icon" aria-hidden>
            📄
          </span>
          <span className="upload-hero__cta-title">
            {busy ? phase || 'Yükleniyor…' : 'PDF’ini Yükle'}
          </span>
          {!busy ? (
            <span className="upload-hero__cta-sub">
              PDF, Word, görsel veya metin — gerisini Studium halleder
            </span>
          ) : null}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            void handleFile(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />

        <div className="upload-hero__meta">
          <label>
            <span>Ders adı</span>
            <input
              className="field"
              value={subject}
              disabled={busy}
              placeholder="İsteğe bağlı"
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            <span>Kitap adı</span>
            <input
              className="field"
              value={title}
              disabled={busy}
              placeholder="İsteğe bağlı"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p className="upload-hero__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </WorkspaceShell>
  )
}
