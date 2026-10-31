import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cachePdfLocally } from '@/lib/pdfCache'
import { rememberPdf } from '@/lib/pdfSession'
import { startBackgroundBookImport } from '@/lib/bookImport'
import { createBookRecord, markBookFailed } from '@/lib/api'
import {
  SUBJECT_OPTIONS,
  fetchMyLibrary,
  rememberLibraryBook,
  subjectToneClass,
} from '@/lib/library'
import { supabase } from '@/lib/supabase'
import { sanitizeForPostgres } from '@/lib/sanitize'
import { useAuth } from '@/lib/auth'
import WorkspaceShell from '@/components/WorkspaceShell'
import LibraryShelf from '@/components/LibraryShelf'
import {
  formatShortWhen,
  formatWorkspaceDate,
  greetingName,
  pickContinueBook,
} from '@/lib/workspaceHome'
import {
  UPLOAD_ACCEPT,
  UPLOAD_HINT,
  isSupportedUpload,
  normalizeUploadToPdf,
} from '@/lib/normalizeUploadFile'

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
  const { user, profile } = useAuth()
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const libQuery = useQuery({
    queryKey: ['my-library', user?.id ?? 'anon'],
    queryFn: () => fetchMyLibrary(user?.id),
  })
  const items = libQuery.data ?? []
  const continueBook = useMemo(() => pickContinueBook(items), [items])
  const today = useMemo(() => formatWorkspaceDate(), [])
  const hello = greetingName({
    displayName: profile?.display_name,
    username: profile?.username,
  })

  async function handleFile(file: File | null) {
    if (!file || busy) return
    if (!isSupportedUpload(file)) {
      setError(
        'Desteklenen türler: PDF, Word (.docx), görsel (PNG/JPG/WebP), TXT/MD.',
      )
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Maksimum ${MAX_MB}MB.`)
      return
    }

    setBusy(true)
    setError(null)
    setWarn(null)
    setPhase('Açılıyor…')
    let bookId: string | null = null

    try {
      const bookTitle = sanitizeForPostgres(
        title.trim() ||
          file.name.replace(/\.[^.]+$/i, '') ||
          'Untitled book',
      )

      setPhase('Hazırlanıyor…')
      const { pdf, converted, truncated } = await normalizeUploadToPdf(file)
      if (converted) setPhase('PDF’e dönüştürüldü…')
      if (truncated) {
        const msg =
          'Uzun metin ilk 80 sayfaya kısaltıldı. PDF olarak yüklemek tam içeriği korur.'
        setWarn(msg)
        try {
          sessionStorage.setItem('studium_upload_warn', msg)
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
    <WorkspaceShell crumb="Kitaplığım" autoTour>
      <div className="ws-home">
        <header className="ws-hero">
          <div>
            <p className="ws-hero__eyebrow">Öğrenme alanın</p>
            <h1 className="ws-hero__title">
              Merhaba {hello}, nereden başlayalım?
            </h1>
            <p className="ws-hero__sub">
              Kaynağını ekle; Studium onu sana özel çalışma notlarına dönüştürsün.
            </p>
          </div>
          <div className="ws-today" aria-hidden>
            <span className="ws-today__k">Bugün</span>
            <span className="ws-today__d">{today.day}</span>
            <span className="ws-today__m">{today.monthShort}</span>
          </div>
        </header>

        <section className="ws-card">
          <p className="ws-card__kicker">Başla</p>
          <h2 className="ws-card__title">Kaynağını yükle, hemen oku</h2>
          <p className="ws-card__lede">
            PDF, Word, görsel veya metin bırak — Studium çalışma PDF’ine çevirir.
          </p>

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
            className={`ws-drop${dragging ? ' is-dragging' : ''}`}
          >
            <span className="ws-drop__btn">
              {busy ? phase || 'İşleniyor…' : '+ Dosya seç'}
            </span>
            <p className="ws-drop__hint">
              {UPLOAD_HINT}
              {subject
                ? ` · ${SUBJECT_OPTIONS.find((o) => o.value === subject)?.label}`
                : ''}
            </p>
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              className="hidden"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <details className="ws-upload-details">
            <summary>
              Ders ve kitap adı
              {subject || title.trim() ? ' · seçili' : ' · isteğe bağlı'}
            </summary>
            <div className="ws-upload__meta">
              <p className="home-desk__meta-label">Ders / alan</p>
              <div className="home-subject-chips" role="group" aria-label="Ders seç">
                {SUBJECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`home-subject-chip${subject === opt.value ? ' is-active' : ''}`}
                    disabled={busy}
                    onClick={() =>
                      setSubject((prev) => (prev === opt.value ? '' : opt.value))
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="home-desk__title-field">
                <span className="home-desk__meta-label">Kitap adı</span>
                <input
                  className="field"
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Boş bırakırsan dosya adı kullanılır"
                />
              </label>
            </div>
          </details>

          {error ? <div className="alert-error mt-3">{error}</div> : null}
          {warn ? <div className="alert-warn mt-3">{warn}</div> : null}
        </section>

        {continueBook ? (
          <section>
            <div className="ws-section-head">
              <h2>
                Devam etmek ister misin?
                <span>· Kaldığın yerden</span>
              </h2>
              <a href="#kitaplik" className="ws-section-link">
                Tüm kitaplık →
              </a>
            </div>
            <div className="ws-card ws-continue">
              <div
                className={`ws-cover ${subjectToneClass(continueBook.item.subject)}`}
                aria-hidden
              >
                {continueBook.item.title.slice(0, 42)}
              </div>
              <div className="ws-continue__meta">
                <p className="ws-continue__when">
                  Son çalışma
                  {continueBook.lastOpenedAt
                    ? ` · ${formatShortWhen(continueBook.lastOpenedAt)}`
                    : ''}
                </p>
                <h3 className="ws-continue__title">{continueBook.item.title}</h3>
                <p className="ws-continue__stats">
                  {continueBook.chapterCount > 0
                    ? `${continueBook.chapterCount} ünite`
                    : 'PDF hazır'}
                  {continueBook.opened > 0
                    ? ` · ${continueBook.opened} açıldı`
                    : ''}
                </p>
                {continueBook.pct > 0 ? (
                  <div className="ws-continue__bar" aria-label={`İlerleme %${continueBook.pct}`}>
                    <span>
                      <i style={{ width: `${continueBook.pct}%` }} />
                    </span>
                    <span className="ws-continue__pct">%{continueBook.pct}</span>
                  </div>
                ) : null}
              </div>
              <div className="ws-continue__actions">
                <Link to={continueBook.item.href} className="ws-continue__cta">
                  Çalışmaya dön →
                </Link>
                {continueBook.dueCount > 0 ? (
                  <Link to="/review" className="ws-continue__review">
                    <strong>{continueBook.dueCount} konu tekrar bekliyor</strong>
                    <span>Hazır olduğunda aç</span>
                  </Link>
                ) : (
                  <Link to="/review" className="ws-continue__review">
                    <strong>Tekrar planı</strong>
                    <span>SRS sıranı gör</span>
                  </Link>
                )}
              </div>
            </div>
          </section>
        ) : null}

        <section id="kitaplik">
          <div className="ws-section-head">
            <h2>
              Kitaplığın
              <span>· Kaynakların</span>
            </h2>
            <label className="ws-search">
              <span aria-hidden>⌕</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kitaplıkta ara"
                aria-label="Kitaplıkta ara"
              />
            </label>
          </div>
          <div className="ws-card" style={{ paddingTop: '0.65rem', paddingBottom: '0.65rem' }}>
            <LibraryShelf searchQuery={search} />
          </div>
        </section>
      </div>
    </WorkspaceShell>
  )
}
