import { useState, type FormEvent } from 'react'
import { useAuth } from '@/lib/auth'

export default function AuthButton() {
  const { user, loading, signIn, signUp, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'up') {
        await signUp(email, password, username, displayName)
      } else {
        await signIn(email, password)
      }
      setOpen(false)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <span className="muted text-xs">…</span>
  }

  if (user) {
    return (
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => void signOut()}
      >
        Çıkış
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        Giriş
      </button>
      {open && (
        <div className="surface-panel absolute right-0 z-50 mt-2 w-80 space-y-3 p-4 shadow-lg">
          <p className="text-sm font-semibold">
            {mode === 'in' ? 'Giriş yap' : 'Hesap oluştur'}
          </p>
          <form onSubmit={onSubmit} className="space-y-2">
            {mode === 'up' && (
              <>
                <input
                  className="field !py-2 text-sm"
                  placeholder="@kullanici_adi"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={24}
                />
                <input
                  className="field !py-2 text-sm"
                  placeholder="Görünen ad"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={48}
                />
              </>
            )}
            <input
              type="email"
              required
              className="field !py-2 text-sm"
              placeholder="E-posta"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              required
              minLength={6}
              className="field !py-2 text-sm"
              placeholder="Şifre (en az 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary w-full text-sm"
              disabled={busy}
            >
              {busy ? '…' : mode === 'in' ? 'Giriş' : 'Kayıt ol'}
            </button>
          </form>
          <button
            type="button"
            className="muted text-[11px] underline"
            onClick={() => {
              setMode((m) => (m === 'in' ? 'up' : 'in'))
              setError(null)
            }}
          >
            {mode === 'in' ? 'Hesap yok mu? Kayıt ol' : 'Zaten hesabım var'}
          </button>
          {error && <div className="alert-error text-xs">{error}</div>}
        </div>
      )}
    </div>
  )
}
