import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cachePdfLocally } from '@/lib/pdfCache'
import { rememberPdf } from '@/lib/pdfSession'
import { startBackgroundBookImport } from '@/lib/bookImport'
import { createBookRecord, createTopicStudy, markBookFailed } from '@/lib/api'
import { rememberLibraryBook } from '@/lib/library'
import { supabase } from '@/lib/supabase'
import { sanitizeForPostgres } from '@/lib/sanitize'
import WorkspaceShell from '@/components/WorkspaceShell'
import TopicStudyChat, { type TopicBrief } from '@/components/TopicStudyChat'
import PdfStudyLobby from '@/components/PdfStudyLobby'
import ReadStudioLobby from '@/components/ReadStudioLobby'
import PracticeLobby from '@/components/PracticeLobby'
import {
  UPLOAD_ACCEPT,
  isSupportedUpload,
  normalizeUploadToPdf,
} from '@/lib/normalizeUploadFile'
import {
  friendlyAiError,
  topicStudyDebugDetail,
} from '@/lib/errors'

const MAX_MB = 50

type EntryMode = 'pick' | 'pdf' | 'topic'

/** Dumb-proof home: PDF upload or topic chat. */
export default function UploadPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [entry, setEntry] = useState<EntryMode>('pick')
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
        subject: subject.trim() || null,
        sourceKind: 'pdf',
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
          source_kind: 'pdf',
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

  async function handleTopic(brief: TopicBrief) {
    if (busy) return
    setBusy(true)
    setError(null)
    setPhase('Konu planlanıyor…')
    let bookId: string | null = null

    try {
      const hintTitle = sanitizeForPostgres(
        title.trim() || brief.goal.slice(0, 72) || 'Konu çalışması',
      )
      const created = await createBookRecord({
        title: hintTitle,
        totalPages: 0,
        subject: subject.trim() || null,
        sourceKind: 'topic',
        progressStep: 'topic_planning',
      })
      bookId = created.id

      setPhase('1/4 · Kavram araştırması…')
      let result: Awaited<ReturnType<typeof createTopicStudy>>
      result = await createTopicStudy({
        bookId,
        goal: brief.goal,
        level: brief.level,
        depth: brief.depth,
        minutes: brief.minutes,
        purpose: brief.purpose,
        subject: subject.trim() || null,
        onStage: (info) => setPhase(info.label),
      })

      rememberLibraryBook({
        bookId,
        title: result.book_title || hintTitle,
        subject: subject.trim() || null,
        source: 'mine',
      })

      const first = result.chapters?.[0]
      if (first?.id) {
        navigate(`/books/${bookId}/chapters/${first.id}?mode=read`, {
          replace: true,
        })
      } else {
        navigate(`/study/${bookId}`, { replace: true })
      }
    } catch (err) {
      const msg = friendlyAiError(err)
      const debug = topicStudyDebugDetail(err)
      const shown = debug ? `${msg}\n\nTeşhis: ${debug}` : msg
      console.error('topic-study client fail', err)
      if (bookId) await markBookFailed(bookId, shown).catch(() => {})
      setError(shown)
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <WorkspaceShell crumb="Başla" autoTour>
      <div className="upload-start">
        <div className="upload-hero">
          {entry === 'pick' ? (
            <>
              <p className="upload-hero__lead">
                PDF’inden çalış veya konuyu söyle — Studium Anlatım ve Alıştır’ı
                hazırlasın.
              </p>

              <div className="upload-hero__doors">
                <button
                  type="button"
                  className="upload-hero__cta"
                  disabled={busy}
                  onClick={() => setEntry('pdf')}
                >
                  <span className="upload-hero__cta-icon" aria-hidden>
                    📄
                  </span>
                  <span className="upload-hero__cta-title">PDF’ini Yükle</span>
                  <span className="upload-hero__cta-sub">
                    PDF, Word, görsel veya metin — kaynaktan çalış
                  </span>
                </button>

                <button
                  type="button"
                  className="upload-hero__cta upload-hero__cta--topic"
                  disabled={busy}
                  onClick={() => setEntry('topic')}
                >
                  <span className="upload-hero__cta-icon" aria-hidden>
                    💬
                  </span>
                  <span className="upload-hero__cta-title">Konudan çalış</span>
                  <span className="upload-hero__cta-sub">
                    Ne öğrenmek istediğini söyle — PDF olmadan ünite kur
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {entry === 'pdf' ? (
            <>
              <button
                type="button"
                className="upload-hero__back"
                disabled={busy}
                onClick={() => {
                  setEntry('pick')
                  setError(null)
                }}
              >
                ← Seçenekler
              </button>
              <p className="upload-hero__lead">
                PDF’ini yükle, Studium özet, zihin haritası, kart ve test
                hazırlasın.
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
                  {busy ? phase || 'Yükleniyor…' : 'Dosya seç'}
                </span>
                {!busy ? (
                  <span className="upload-hero__cta-sub">
                    PDF, Word, görsel veya metin
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
            </>
          ) : null}

          {entry === 'topic' ? (
            <>
              <button
                type="button"
                className="upload-hero__back"
                disabled={busy}
                onClick={() => {
                  setEntry('pick')
                  setError(null)
                  setPhase(null)
                }}
              >
                ← Seçenekler
              </button>
              {busy && phase ? (
                <p className="upload-hero__phase" role="status">
                  {phase}
                </p>
              ) : null}
              <TopicStudyChat
                busy={busy}
                onCancel={() => {
                  setEntry('pick')
                  setError(null)
                }}
                onConfirm={(brief) => void handleTopic(brief)}
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
                  <span>Başlık ipucu</span>
                  <input
                    className="field"
                    value={title}
                    disabled={busy}
                    placeholder="İsteğe bağlı"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              </div>
            </>
          ) : null}

          {error ? (
            <p className="upload-hero__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {entry === 'pick' ? (
          <aside className="upload-preview" aria-label="Studium’da neler var">
            <p className="upload-preview__kicker">
              Kaynağını seçince bunlar seni bekler
            </p>

            <section
              className="upload-preview__block upload-preview__block--pdf"
              aria-label="1 · PDF’den çalış"
            >
              <div className="upload-preview__block-bar">
                <span className="upload-preview__step">1</span>
                <div className="upload-preview__block-copy">
                  <p className="upload-preview__block-eye">Kaynak masası</p>
                  <h3 className="upload-preview__block-title">PDF’den çalış</h3>
                </div>
              </div>
              <div className="upload-preview__block-body">
                <PdfStudyLobby />
              </div>
            </section>

            <section
              className="upload-preview__block upload-preview__block--read"
              aria-label="2 · Anlatım"
            >
              <div className="upload-preview__block-bar">
                <span className="upload-preview__step">2</span>
                <div className="upload-preview__block-copy">
                  <p className="upload-preview__block-eye">Öğrenme</p>
                  <h3 className="upload-preview__block-title">Anlatım</h3>
                </div>
              </div>
              <div className="upload-preview__block-body">
                <ReadStudioLobby preview />
              </div>
            </section>

            <section
              className="upload-preview__block upload-preview__block--practice"
              aria-label="3 · Alıştır"
            >
              <div className="upload-preview__block-bar">
                <span className="upload-preview__step">3</span>
                <div className="upload-preview__block-copy">
                  <p className="upload-preview__block-eye">Pekiştirme</p>
                  <h3 className="upload-preview__block-title">Alıştır</h3>
                </div>
              </div>
              <div className="upload-preview__block-body">
                <PracticeLobby preview />
              </div>
            </section>
          </aside>
        ) : null}
      </div>
    </WorkspaceShell>
  )
}
