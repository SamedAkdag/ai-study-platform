/** Device-local TTS via Web Speech API (works in modern browsers). */

export type TtsStatus = 'idle' | 'speaking' | 'paused' | 'unsupported'

export const DEFAULT_TTS_LANG = 'tr-TR'

const RATE_KEY = 'studium_tts_rate'
const VOICE_KEY = 'studium_tts_voice'
const LANG_KEY = 'studium_tts_lang'

/** Common language choices; Turkish is default. */
export const TTS_LANG_OPTIONS: { code: string; label: string }[] = [
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'es-ES', label: 'Español' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'ar-SA', label: 'العربية' },
  { code: 'ru-RU', label: 'Русский' },
]

export function isTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Strip markdown so TTS reads clean study text. */
export function markdownToSpeechText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split into speakable chunks (sentence-ish). */
export function splitForSpeech(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const parts = cleaned.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [cleaned]
  return parts.map((p) => p.trim()).filter((p) => p.length > 1)
}

export function getStoredRate(): number {
  try {
    const n = Number(localStorage.getItem(RATE_KEY))
    if (Number.isFinite(n) && n >= 0.6 && n <= 1.6) return n
  } catch {
    /* ignore */
  }
  return 1
}

export function setStoredRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate))
  } catch {
    /* ignore */
  }
}

export function getStoredLang(): string {
  try {
    const v = localStorage.getItem(LANG_KEY)?.trim()
    if (v) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_TTS_LANG
}

export function setStoredLang(lang: string) {
  try {
    localStorage.setItem(LANG_KEY, lang || DEFAULT_TTS_LANG)
  } catch {
    /* ignore */
  }
}

export function getStoredVoiceUri(): string {
  try {
    return localStorage.getItem(VOICE_KEY) || ''
  } catch {
    return ''
  }
}

export function setStoredVoiceUri(uri: string) {
  try {
    if (uri) localStorage.setItem(VOICE_KEY, uri)
    else localStorage.removeItem(VOICE_KEY)
  } catch {
    /* ignore */
  }
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!isTtsSupported()) return []
  return window.speechSynthesis.getVoices()
}

export function langPrefix(lang: string) {
  return (lang || DEFAULT_TTS_LANG).split(/[-_]/)[0]!.toLowerCase()
}

/** Match voice to language by lang code and common voice names (esp. Windows TR). */
export function voiceMatchesLang(
  voice: SpeechSynthesisVoice,
  lang: string,
): boolean {
  const prefix = langPrefix(lang)
  const vLang = (voice.lang || '').replace('_', '-')
  if (langPrefix(vLang) === prefix) return true

  const name = voice.name || ''
  if (prefix === 'tr') {
    return /turkish|t[uü]rk[cç]e|\btolga\b|\bemel\b|\bahmet\b|\belif\b/i.test(
      name,
    )
  }
  if (prefix === 'en') {
    return /english|george|susan|zira|david|mark|hazel|ravi/i.test(name)
  }
  if (prefix === 'de') return /german|deutsch|hedda|stefan|katja/i.test(name)
  if (prefix === 'fr') return /french|français|hortense|paul|julie/i.test(name)
  if (prefix === 'es') return /spanish|español|helena|pablo|sabina/i.test(name)
  return false
}

export function voicesForLang(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice[] {
  return voices.filter((v) => voiceMatchesLang(v, lang))
}

/** Prefer saved voice, else best match for lang (default Turkish). */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  preferredUri?: string,
  lang: string = DEFAULT_TTS_LANG,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const pool = voicesForLang(voices, lang)
  if (preferredUri) {
    const inPool = pool.find((v) => v.voiceURI === preferredUri)
    if (inPool) return inPool
  }
  if (!pool.length) return null

  const prefix = langPrefix(lang)
  const local = pool.find(
    (v) => v.localService && voiceMatchesLang(v, lang),
  )
  if (local) return local
  const exact = pool.find(
    (v) => (v.lang || '').replace('_', '-').toLowerCase() === lang.toLowerCase(),
  )
  if (exact) return exact
  if (prefix === 'tr') {
    const named = pool.find((v) => /tolga|emel|turkish|t[uü]rk/i.test(v.name))
    if (named) return named
  }
  return pool[0] || null
}

type SpeakHandlers = {
  onStatus?: (s: TtsStatus) => void
  onChunk?: (index: number, total: number, text: string) => void
  onEnd?: () => void
  onError?: (message: string) => void
}

let queueToken = 0

export function stopSpeech() {
  queueToken += 1
  if (!isTtsSupported()) return
  window.speechSynthesis.cancel()
}

export function pauseSpeech() {
  if (!isTtsSupported()) return
  window.speechSynthesis.pause()
}

export function resumeSpeech() {
  if (!isTtsSupported()) return
  window.speechSynthesis.resume()
}

export function speakText(
  text: string,
  opts: {
    rate?: number
    voiceUri?: string
    lang?: string
  } & SpeakHandlers = {},
) {
  if (!isTtsSupported()) {
    opts.onError?.('Bu tarayıcıda sesli okuma yok')
    opts.onStatus?.('unsupported')
    return
  }

  stopSpeech()
  const myToken = queueToken
  const chunks = splitForSpeech(text)
  if (!chunks.length) {
    opts.onError?.('Okunacak metin yok')
    opts.onStatus?.('idle')
    return
  }

  const lang = opts.lang || getStoredLang() || DEFAULT_TTS_LANG
  const voices = listVoices()
  const voice = pickVoice(
    voices,
    opts.voiceUri || getStoredVoiceUri(),
    lang,
  )
  // Never force an English voice when Turkish is selected but TR pack is missing
  const rate = opts.rate ?? getStoredRate()
  let i = 0

  const speakNext = () => {
    if (myToken !== queueToken) return
    if (i >= chunks.length) {
      opts.onStatus?.('idle')
      opts.onEnd?.()
      return
    }
    const chunk = chunks[i]!
    opts.onChunk?.(i, chunks.length, chunk)
    const u = new SpeechSynthesisUtterance(chunk)
    u.rate = rate
    u.lang = lang
    if (voice) {
      u.voice = voice
      u.lang = voice.lang || lang
    }
    u.onstart = () => {
      if (myToken === queueToken) opts.onStatus?.('speaking')
    }
    u.onend = () => {
      if (myToken !== queueToken) return
      i += 1
      speakNext()
    }
    u.onerror = (ev) => {
      if (myToken !== queueToken) return
      if (ev.error === 'canceled' || ev.error === 'interrupted') return
      opts.onError?.(ev.error || 'Okuma hatası')
      opts.onStatus?.('idle')
    }
    window.speechSynthesis.speak(u)
  }

  speakNext()
}

/** From selected snippet: speak selection + remainder of full text after it. */
export function textFromSelection(fullText: string, selected: string): string {
  const full = fullText.replace(/\s+/g, ' ').trim()
  const sel = selected.replace(/\s+/g, ' ').trim()
  if (!sel) return full
  const idx = full.toLowerCase().indexOf(sel.toLowerCase())
  if (idx < 0) return sel
  return full.slice(idx).trim()
}
