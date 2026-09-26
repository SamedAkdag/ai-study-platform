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

      // Topic-aware study sessions + subtopics
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
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <header className="space-y-3 text-center">
        <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
          AI Study Platform
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Upload your textbook. Study smarter.
        </h1>
        <p className="text-slate-600">
          PDF tarayıcıda okunur · ~20 dk’lık konu oturumları · içerik üniteye
          tıklayınca AI ile üretilir
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Kitap adı (opsiyonel)</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-slate-400"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Örn. Calculus I"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Konu (opsiyonel)</span>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-slate-400"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="">Seç…</option>
            <option value="Math">Math</option>
            <option value="Physics">Physics</option>
            <option value="History">History</option>
            <option value="Other">Other</option>
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-16 text-center transition ${
          dragging
            ? 'border-slate-500 bg-slate-100'
            : 'border-slate-300 bg-white hover:border-slate-400'
        }`}
      >
        <span className="text-lg font-medium text-slate-800">
          {busy ? 'İşleniyor…' : 'PDF sürükle veya seç'}
        </span>
        <span className="text-sm text-slate-500">.pdf · max {MAX_MB}MB</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
