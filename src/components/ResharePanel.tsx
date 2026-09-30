import { useState } from 'react'
import SendStudyButton from '@/components/SendStudyButton'

type Props = {
  bookId: string
  bookTitle: string
  shareToken: string
  /** When false, show locked message instead of actions. */
  canReshare: boolean
}

/** Recipient reshare: public link + friend send (only when book is public). */
export default function ResharePanel({
  bookId,
  bookTitle,
  shareToken,
  canReshare,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  async function copyLink() {
    const url = `${window.location.origin}/s/${shareToken}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Paylaşım linkini kopyala:', url)
    }
  }

  if (!canReshare) {
    return (
      <p className="muted text-xs">
        Bu çalışma private. Yalnızca sahibi başkalarıyla paylaşabilir.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Kapat' : 'Başkasıyla paylaş'}
      </button>
      {open && (
        <div
          className="space-y-3 rounded-xl border p-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <p className="muted text-[11px]">
            Public çalışma — linki kopyalayabilir veya arkadaşına
            gönderebilirsin.
          </p>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => void copyLink()}
          >
            {copied ? 'Link kopyalandı ✓' : 'Public linki kopyala'}
          </button>
          <SendStudyButton bookId={bookId} bookTitle={bookTitle} />
        </div>
      )}
    </div>
  )
}
