/** Normalize Supabase / unknown failures into Error with a readable message. */
export function asError(err: unknown, fallback = 'İşlem başarısız'): Error {
  if (err instanceof Error) return err
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown; details?: unknown; code?: unknown }
    const parts = [o.message, o.details, o.code].filter(
      (p) => typeof p === 'string' && p.trim(),
    ) as string[]
    if (parts.length) return new Error(parts.join(' — '))
    if (typeof o.error === 'string' && o.error.trim()) return new Error(o.error)
  }
  if (typeof err === 'string' && err.trim()) return new Error(err)
  return new Error(fallback)
}

export function throwAsError(err: unknown, fallback?: string): never {
  throw asError(err, fallback)
}

/** User-facing AI / edge-function errors (hide raw JSON dumps). */
export function friendlyAiError(err: unknown): string {
  const raw = asError(err).message || ''
  const lower = raw.toLowerCase()

  if (/not valid json|json parse|ai response was not valid/i.test(raw)) {
    return 'AI geçici olarak bozuk yanıt verdi. Bir kez daha dene — genelde ikinci denemede düzelir.'
  }
  if (/rate.?limit|429|too many requests|quota/i.test(lower)) {
    return 'AI şu an meşgul (kota). 20–30 sn sonra tekrar dene.'
  }
  if (/failed to (send|fetch)|network|load failed|timeout|timed out/i.test(lower)) {
    return 'Bağlantı koptu veya zaman aşımı. İnternetini kontrol edip tekrar dene.'
  }
  if (/no page_text|cannot generate/i.test(lower)) {
    return 'Bu ünite için PDF metni yok — taranmış PDF olabilir veya metin çıkarılamadı.'
  }
  if (/tokenharbor|mimo|api.?key|edge secrets/i.test(lower)) {
    return 'AI servisi yapılandırma hatası. Biraz sonra tekrar dene.'
  }
  if (raw.length > 180) return `${raw.slice(0, 160)}…`
  return raw || 'Üretim başarısız — tekrar dene.'
}

export function isRetryableAiError(err: unknown): boolean {
  const raw = asError(err).message.toLowerCase()
  return /json|rate.?limit|429|timeout|timed out|meşgul|bozuk|network|fetch|failed to send/.test(
    raw,
  )
}
