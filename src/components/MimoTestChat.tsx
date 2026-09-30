import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { extractFunctionsError } from '@/lib/functionsError'

export default function MimoTestChat() {
  const [message, setMessage] = useState('Merhaba, kendini kısaca tanıtır mısın?')
  const [reply, setReply] = useState<string | null>(null)
  const [meta, setMeta] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (busy) return
    setBusy(true)
    setError(null)
    setReply(null)
    setMeta(null)

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'test-mimo',
        { body: { message: message.trim() || 'Merhaba' } },
      )

      if (fnError) {
        throw new Error(await extractFunctionsError(fnError, data))
      }
      if (data?.error) throw new Error(String(data.error))

      setReply(String(data?.reply ?? ''))
      setMeta(
        `model: ${data?.model ?? '?'} · base: ${data?.baseURL ?? '?'}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface-panel mb-8 space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg font-semibold">MiMo test chat</p>
        <p className="muted text-xs">
          Edge → Token Harbor (ünite ayırmadan bağımsız)
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field flex-1"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          placeholder="Test mesajı…"
          disabled={busy}
        />
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? 'Gönderiliyor…' : 'MiMo’ya sor'}
        </button>
      </div>
      {meta && <p className="muted text-xs">{meta}</p>}
      {reply && (
        <div
          className="rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap"
          style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.6)' }}
        >
          {reply}
        </div>
      )}
      {error && <div className="alert-error text-sm break-words">{error}</div>}
    </div>
  )
}
