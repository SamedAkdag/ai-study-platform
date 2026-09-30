import type { useTts } from '@/hooks/useTts'
import { TTS_LANG_OPTIONS, langPrefix } from '@/lib/tts'

type TtsApi = ReturnType<typeof useTts>

type Props = {
  tts: TtsApi
  onReadAll: () => void
  label?: string
  compact?: boolean
}

export default function TtsControls({
  tts,
  onReadAll,
  label = 'Sesli oku',
  compact,
}: Props) {
  if (!tts.supported) {
    return (
      <p className="muted text-xs">
        Bu tarayıcıda yerel sesli okuma (TTS) yok.
      </p>
    )
  }

  const busy = tts.status === 'speaking' || tts.status === 'paused'
  const isTr = langPrefix(tts.lang) === 'tr'
  const noVoicesForLang = tts.voices.length === 0

  return (
    <div className="space-y-2">
      <div className={`study-toolbar ${compact ? '!p-0 !border-0 !bg-transparent' : ''}`}>
        {!busy ? (
          <button
            type="button"
            className="btn-primary !px-3 !py-1.5 text-xs"
            onClick={onReadAll}
          >
            {label}
          </button>
        ) : (
          <>
            {tts.status === 'speaking' ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={tts.pause}
              >
                Duraklat
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary !px-3 !py-1.5 text-xs"
                onClick={tts.resume}
              >
                Devam
              </button>
            )}
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={tts.stop}
            >
              Durdur
            </button>
          </>
        )}

        <label className="muted flex items-center gap-1.5 text-[11px] font-semibold">
          Dil
          <select
            className="rounded-md border bg-white px-2 py-1 text-[11px] font-medium text-[var(--ink)]"
            style={{ borderColor: 'var(--line-strong)' }}
            value={tts.lang}
            onChange={(e) => tts.setLang(e.target.value)}
            title="Okuma dili"
          >
            {TTS_LANG_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="muted flex items-center gap-1.5 text-[11px] font-semibold">
          Hız
          <input
            type="range"
            min={0.7}
            max={1.4}
            step={0.05}
            value={tts.rate}
            onChange={(e) => tts.setRate(Number(e.target.value))}
            className="w-20"
          />
          <span className="tabular-nums text-[var(--ink)]">
            {tts.rate.toFixed(2)}×
          </span>
        </label>

        {tts.voices.length > 0 ? (
          <label className="muted flex items-center gap-1.5 text-[11px] font-semibold">
            Ses
            <select
              className="max-w-[200px] rounded-md border bg-white px-2 py-1 text-[11px] font-medium text-[var(--ink)]"
              style={{ borderColor: 'var(--line-strong)' }}
              value={tts.voiceUri || tts.preferredVoice?.voiceURI || ''}
              onChange={(e) => tts.setVoiceUri(e.target.value)}
              title="Konuşmacı"
            >
              {tts.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {tts.chunkInfo && (
          <span className="muted text-[11px] tabular-nums">
            {tts.chunkInfo.index + 1}/{tts.chunkInfo.total}
          </span>
        )}
        {tts.error && (
          <span className="text-[11px]" style={{ color: 'var(--danger)' }}>
            {tts.error}
          </span>
        )}
      </div>

      {noVoicesForLang && isTr && (
        <p className="muted text-[11px] leading-relaxed">
          Türkçe konuşmacı bulunamadı. Windows’ta Konuşma dil paketini yükle;
          yine de tr-TR ile denenecek.
        </p>
      )}
      {noVoicesForLang && !isTr && (
        <p className="muted text-[11px]">
          Bu dil için yüklü konuşmacı yok.
        </p>
      )}
    </div>
  )
}
