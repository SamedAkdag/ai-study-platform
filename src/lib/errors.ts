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

const TOPIC_STEP_LABELS: Record<string, string> = {
  init: 'Başlangıç',
  topic_research: '1/3 Kavram araştırması',
  topic_cluster: '2/3 Öğrenme kümeleri',
  topic_write_1_of_1: '3/3 Ünite yazımı',
  topic_write_batch: '3/3 Ünite yazımı (toplu)',
  topic_saving: 'Kayıt',
}

/** Pull [topic_research] style step tag from edge diagnostics. */
export function topicStudyStepLabel(err: unknown): string | null {
  const raw = asError(err).message || ''
  const m = raw.match(/\[(topic_[a-z0-9_]+)\]/i)
  if (!m?.[1]) return null
  return TOPIC_STEP_LABELS[m[1]] || m[1]
}

/** Extra provider line for topic-study debugging (status/body/model). */
export function topicStudyDebugDetail(err: unknown): string | null {
  const raw = asError(err).message || ''
  const detail = raw.match(/Detail:\s*(.+?)(?:\s+Model:|$)/i)?.[1]?.trim()
  const model = raw.match(/Model:\s*(\S+)/i)?.[1]?.trim()
  const parts = [detail, model ? `model ${model}` : ''].filter(Boolean)
  if (!parts.length) return null
  return parts.join(' · ').slice(0, 280)
}

/** User-facing AI / edge-function errors (hide raw JSON dumps). */
export function friendlyAiError(err: unknown): string {
  const raw = asError(err).message || ''
  const lower = raw.toLowerCase()
  const step = topicStudyStepLabel(err)
  const withStep = (msg: string) => (step ? `${step} — ${msg}` : msg)

  if (/compute resources|worker_resource|546/i.test(lower)) {
    return withStep(
      'Sunucu bu ünite için yetersiz kaldı. Biraz sonra tekrar dene (daha kısa üniteler daha sorunsuz).',
    )
  }
  if (/not valid json|json parse|ai response was not valid/i.test(raw)) {
    return withStep(
      'AI geçici olarak bozuk yanıt verdi. Bir kez daha dene — genelde ikinci denemede düzelir.',
    )
  }
  if (
    /\b402\b|no active plan|wallet balance|out of credits|insufficient_quota|hard_quota|ai_quota|billing/i.test(
      lower,
    )
  ) {
    return withStep(
      'Token Harbor bakiyesi / plan yok. tokenharbor.ai hesabına kredi yükle veya plan aç, sonra tekrar dene.',
    )
  }
  // Narrow: bare "rpm"/"tpm"/"quota" false-positives hid real provider errors.
  if (
    /\b429\b|rate.?limit|too many requests|insufficient_quota|tokens per (minute|day)/i.test(
      lower,
    )
  ) {
    return withStep('AI şu an meşgul (hız limiti). 20–30 sn sonra tekrar dene.')
  }
  if (/failed to (send|fetch)|network|load failed|timeout|timed out/i.test(lower)) {
    return 'Bağlantı koptu veya zaman aşımı. İnternetini kontrol edip tekrar dene.'
  }
  if (/no page_text|cannot generate/i.test(lower)) {
    return 'Bu ünite için PDF metni yok — taranmış PDF olabilir veya metin çıkarılamadı.'
  }
  // Only real missing-secret / misconfig — do NOT match "MiMo failed" runtime errors.
  if (
    /edge secrets|is not set in edge|(api.?key|secret).{0,40}(missing|not set)|(missing|not set).{0,40}(api.?key|secret)/i.test(
      lower,
    )
  ) {
    return 'AI servisi yapılandırma hatası. Biraz sonra tekrar dene.'
  }
  if (/unauthorized|401|invalid.?api.?key|incorrect.?api.?key/i.test(lower)) {
    return 'AI anahtarı reddedildi. Biraz sonra tekrar dene veya ayarları kontrol et.'
  }
  if (/empty (mimo|ai)?\s*response|empty content/i.test(lower)) {
    return 'AI boş yanıt döndü. Bir kez daha dene.'
  }
  if (/ai error 400|bad request/i.test(lower)) {
    return withStep(
      'AI isteği reddedildi (400). Bir kez daha dene; sürmezse kısa bir konu yaz.',
    )
  }
  if (raw.length > 180) return withStep(`${raw.slice(0, 160)}…`)
  return withStep(raw || 'Üretim başarısız — tekrar dene.')
}

export function isRetryableAiError(err: unknown): boolean {
  const raw = asError(err).message.toLowerCase()
  return /json|rate.?limit|429|timeout|timed out|meşgul|bozuk|network|fetch|failed to send|compute resources|546/.test(
    raw,
  )
}

/** User-facing EMA / browser TTS failures (Dinle, site-wide speak). */
export function friendlyEmaError(err: unknown): string {
  const raw = asError(err).message || ''
  const lower = raw.toLowerCase()
  if (/abort/i.test(lower)) return 'İşlem iptal edildi.'
  if (
    /webgpu|gpu|adapter|device lost|wasm|onnx|ort|out of memory|oom/i.test(
      lower,
    )
  ) {
    return 'Bu tarayıcıda ses modeli yüklenemedi. Chrome/Edge dene veya sayfayı yenileyip tekrar başlat.'
  }
  if (/failed to (send|fetch)|network|load failed|timeout|timed out|404|cors/i.test(lower)) {
    return 'Ses modeli indirilemedi. İnternetini kontrol edip tekrar dene (ilk seferde ~30–40 MB).'
  }
  if (/quota|storage|indexeddb/i.test(lower)) {
    return 'Tarayıcı depolama dolu olabilir. Biraz yer açıp tekrar dene.'
  }
  if (raw.length > 160) return `${raw.slice(0, 140)}…`
  return raw || 'Ses üretilemedi — tekrar dene.'
}
