import { useEffect, useState } from 'react'
import type { UnitScope } from '@/lib/unitScope'

type Props = {
  open: boolean
  maxPage: number
  /** When units already exist, only range-append is offered */
  hasUnits?: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: (scope: UnitScope) => void
}

/**
 * Simple choice before segmentation: whole book or a page range.
 */
export default function UnitScopeDialog({
  open,
  maxPage,
  hasUnits = false,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const max = Math.max(1, maxPage || 1)
  const [mode, setMode] = useState<'all' | 'range'>(
    hasUnits ? 'range' : 'all',
  )
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(Math.min(20, max))

  useEffect(() => {
    if (!open) return
    setMode(hasUnits ? 'range' : 'all')
    setFrom(1)
    setTo(Math.min(20, max))
  }, [open, hasUnits, max])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const fromN = Math.min(max, Math.max(1, from || 1))
  const toN = Math.min(max, Math.max(1, to || 1))
  const lo = Math.min(fromN, toN)
  const hi = Math.max(fromN, toN)
  const rangeOk = hi >= lo && hi - lo + 1 >= 1

  return (
    <div
      className="unit-scope"
      role="dialog"
      aria-modal="true"
      aria-label="Ünite kapsamı"
    >
      <button
        type="button"
        className="unit-scope__backdrop"
        aria-label="Kapat"
        disabled={busy}
        onClick={onClose}
      />
      <div className="unit-scope__card surface-panel">
        <p className="section-label mb-1">Anlatım · üniteler</p>
        <h2 className="unit-scope__title">
          {hasUnits ? 'Hangi sayfaları ekleyelim?' : 'Nereden ünite oluşturalım?'}
        </h2>
        <p className="muted text-sm unit-scope__lead">
          {hasUnits
            ? 'Mevcut üniteler kalır; seçtiğin sayfa aralığı yeni ünite olarak eklenir.'
            : 'Tüm kitap veya sadece çalışmak istediğin sayfa aralığı — sen seç.'}
        </p>

        <div className="unit-scope__choices" role="radiogroup">
          {!hasUnits ? (
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'all'}
              className={`unit-scope__choice${
                mode === 'all' ? ' unit-scope__choice--on' : ''
              }`}
              disabled={busy}
              onClick={() => setMode('all')}
            >
              <span className="unit-scope__choice-emoji" aria-hidden>
                📚
              </span>
              <span>
                <strong>Tüm kitap</strong>
                <span className="muted block text-xs">
                  Sayfa 1–{max} · AI ünite ayırır
                </span>
              </span>
            </button>
          ) : null}

          <button
            type="button"
            role="radio"
            aria-checked={mode === 'range'}
            className={`unit-scope__choice${
              mode === 'range' ? ' unit-scope__choice--on' : ''
            }`}
            disabled={busy}
            onClick={() => setMode('range')}
          >
            <span className="unit-scope__choice-emoji" aria-hidden>
              ✂️
            </span>
            <span>
              <strong>Belirli sayfalar</strong>
              <span className="muted block text-xs">
                Sadece seçtiğin aralık üniteleşir
              </span>
            </span>
          </button>
        </div>

        {mode === 'range' ? (
          <div className="unit-scope__range">
            <label className="unit-scope__field">
              <span>Başlangıç</span>
              <input
                type="number"
                className="field"
                min={1}
                max={max}
                value={from}
                disabled={busy}
                onChange={(e) => setFrom(Number(e.target.value))}
              />
            </label>
            <span className="unit-scope__dash" aria-hidden>
              –
            </span>
            <label className="unit-scope__field">
              <span>Bitiş</span>
              <input
                type="number"
                className="field"
                min={1}
                max={max}
                value={to}
                disabled={busy}
                onChange={(e) => setTo(Number(e.target.value))}
              />
            </label>
            <p className="muted text-xs unit-scope__hint">
              Kitapta {max} sayfa var · seçim: {lo}–{hi} (
              {hi - lo + 1} sayfa)
            </p>
          </div>
        ) : null}

        <div className="unit-scope__actions">
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || (mode === 'range' && !rangeOk)}
            onClick={() => {
              if (mode === 'all') onConfirm({ mode: 'all' })
              else onConfirm({ mode: 'range', from: lo, to: hi })
            }}
          >
            {busy
              ? 'Başlıyor…'
              : hasUnits
                ? 'Aralığı ekle'
                : mode === 'all'
                  ? 'Tüm kitabı ayır'
                  : 'Bu aralığı ayır'}
          </button>
        </div>
      </div>
    </div>
  )
}
