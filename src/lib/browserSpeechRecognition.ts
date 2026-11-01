/**
 * Free, on-device STT via Web Speech API — no server cost.
 * Cannot install language packs from the page; we request tr-TR and fall back.
 */

export type SpeechRecStatus =
  | 'unsupported'
  | 'idle'
  | 'listening'
  | 'denied'
  | 'no-speech'
  | 'lang-unavailable'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onerror:
    | ((
        this: SpeechRecognitionLike,
        ev: { error: string; message?: string },
      ) => void)
    | null
  onresult:
    | ((
        this: SpeechRecognitionLike,
        ev: {
          resultIndex: number
          results: ArrayLike<{
            isFinal: boolean
            0: { transcript: string }
            length: number
          }>
        },
      ) => void)
    | null
}

function getRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isBrowserSpeechRecognitionSupported(): boolean {
  return Boolean(getRecognitionCtor())
}

/** Preferred spoken languages for study (Turkish first). */
const LANG_CANDIDATES = ['tr-TR', 'tr', 'tr-tr'] as const

export type BrowserSpeechSession = {
  start: () => void
  stop: () => void
  abort: () => void
}

/**
 * Start a recognition session. Prefers Turkish; if the engine rejects the
 * language we retry once with the browser default (still free).
 */
export function createBrowserSpeechSession(opts: {
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onStatus?: (s: SpeechRecStatus) => void
  onErrorMessage?: (msg: string) => void
}): BrowserSpeechSession | null {
  const Ctor = getRecognitionCtor()
  if (!Ctor) {
    opts.onStatus?.('unsupported')
    return null
  }

  let rec: SpeechRecognitionLike | null = null
  let stopped = false
  let langIndex = 0
  let triedFallback = false

  function bind(r: SpeechRecognitionLike, lang: string) {
    r.lang = lang
    r.continuous = false
    r.interimResults = true
    r.maxAlternatives = 1

    r.onstart = () => {
      if (!stopped) opts.onStatus?.('listening')
    }

    r.onresult = (ev) => {
      let interim = ''
      let finalChunk = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i]
        if (!row) continue
        const t = row[0]?.transcript || ''
        if (row.isFinal) finalChunk += t
        else interim += t
      }
      if (interim) opts.onInterim?.(interim)
      if (finalChunk.trim()) opts.onFinal?.(finalChunk.trim())
    }

    r.onerror = (ev) => {
      const code = String(ev.error || '')
      if (code === 'aborted' || code === 'no-speech') {
        if (code === 'no-speech') opts.onStatus?.('no-speech')
        return
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        opts.onStatus?.('denied')
        opts.onErrorMessage?.(
          'Mikrofon izni yok — tarayıcı ayarlarından izin ver.',
        )
        return
      }
      if (
        (code === 'language-not-supported' || code === 'service-not-allowed') &&
        !triedFallback
      ) {
        triedFallback = true
        opts.onErrorMessage?.(
          'Türkçe ses tanıma bu tarayıcıda yok; varsayılan dil deneniyor…',
        )
        window.setTimeout(() => startWithLang(''), 40)
        return
      }
      if (code === 'language-not-supported') {
        opts.onStatus?.('lang-unavailable')
        opts.onErrorMessage?.(
          'Türkçe konuşma tanıma bulunamadı. Chrome’da Türkçe dil paketini yükleyebilir veya soruyu yazabilirsin.',
        )
        return
      }
      opts.onErrorMessage?.(`Ses tanıma: ${code}`)
    }

    r.onend = () => {
      if (!stopped) opts.onStatus?.('idle')
    }
  }

  function startWithLang(lang: string) {
    if (stopped) return
    try {
      rec?.abort()
    } catch {
      /* ignore */
    }
    const r = new Ctor!()
    rec = r
    bind(r, lang || LANG_CANDIDATES[0]!)
    if (!lang) {
      // Empty → leave engine default after failed tr-TR
      r.lang = ''
    }
    try {
      r.start()
    } catch (err) {
      opts.onErrorMessage?.(
        err instanceof Error ? err.message : 'Mikrofon başlatılamadı',
      )
      opts.onStatus?.('idle')
    }
  }

  return {
    start() {
      stopped = false
      triedFallback = false
      langIndex = 0
      startWithLang(LANG_CANDIDATES[langIndex]!)
    },
    stop() {
      stopped = true
      try {
        rec?.stop()
      } catch {
        /* ignore */
      }
      opts.onStatus?.('idle')
    },
    abort() {
      stopped = true
      try {
        rec?.abort()
      } catch {
        /* ignore */
      }
      opts.onStatus?.('idle')
    },
  }
}
