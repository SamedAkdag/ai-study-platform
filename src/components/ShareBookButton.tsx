import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { disableBookShare, enableBookShare } from '@/lib/api'
import GroupSharePanel from '@/components/GroupSharePanel'
import type { Book } from '@/types/database'

type Props = {
  book: Book
}

export default function ShareBookButton({ book }: Props) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enableMutation = useMutation({
    mutationFn: () => enableBookShare(book.id),
    onSuccess: async (updated) => {
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['book', book.id] })
      await queryClient.invalidateQueries({ queryKey: ['study-group', book.id] })
      if (updated.share_token) {
        await copyLink(updated.share_token)
      }
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : 'Paylaşım açılamadı. SQL migration çalıştırıldı mı?',
      )
    },
  })

  const disableMutation = useMutation({
    mutationFn: () => disableBookShare(book.id),
    onSuccess: async () => {
      setError(null)
      setCopied(false)
      await queryClient.invalidateQueries({ queryKey: ['book', book.id] })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Paylaşım kapatılamadı')
    },
  })

  async function copyLink(token: string) {
    const url = `${window.location.origin}/s/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Paylaşım linkini kopyala:', url)
    }
  }

  const isPublic = !!book.is_public && !!book.share_token
  const busy = enableMutation.isPending || disableMutation.isPending

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isPublic ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => enableMutation.mutate()}
            className="btn-primary"
          >
            Public yap + grup oluştur
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void copyLink(book.share_token!)}
              className="btn-primary"
            >
              {copied ? 'Public link kopyalandı ✓' : 'Public linki kopyala'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => disableMutation.mutate()}
              className="btn-ghost"
            >
              Private yap
            </button>
          </>
        )}
      </div>
      {!isPublic && (
        <p className="muted text-xs">
          Private iken yalnızca sen arkadaşlarına gönderebilirsin; alan kişi
          başkasıyla paylaşamaz. Public açınca link + yeniden paylaşım açılır.
        </p>
      )}
      {isPublic && (
        <>
          <p className="muted text-xs">
            Public — linki olan herkes okuyabilir ve başkasıyla paylaşabilir.
          </p>
          <p className="muted break-all text-xs">
            {window.location.origin}/s/{book.share_token}
          </p>
          <GroupSharePanel bookId={book.id} shareToken={book.share_token} />
        </>
      )}
      {error && <div className="alert-error text-sm">{error}</div>}
    </div>
  )
}
