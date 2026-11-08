import {
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  speakText,
  stopSpeech,
  toLectureSpeechText,
} from '@/lib/tts'

const AUTO_SPEAK_KEY = 'studium.pdfAi.autoSpeak'

type SpeakHandlers = {
  onSpeaking?: (active: boolean) => void
  onError?: (msg: string) => void
}

let activeSpeaking: ((active: boolean) => void) | null = null

/** Opt-in: auto-read AI answers in the PDF assist panel. */
export function getPdfAiAutoSpeak(): boolean {
  try {
    return localStorage.getItem(AUTO_SPEAK_KEY) === '1'
  } catch {
    return false
  }
}

export function setPdfAiAutoSpeak(on: boolean) {
  try {
    localStorage.setItem(AUTO_SPEAK_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** Speak PDF selection / page text with the same TTS path as Dinle. */
export function speakPdfText(text: string, handlers: SpeakHandlers = {}) {
  const spoken = toLectureSpeechText(text) || text.trim()
  if (!spoken) {
    handlers.onError?.('Okunacak metin yok')
    return false
  }
  activeSpeaking?.(false)
  activeSpeaking = handlers.onSpeaking ?? null
  handlers.onSpeaking?.(true)
  speakText(spoken, {
    rate: getStoredRate(),
    voiceUri: getStoredVoiceUri(),
    lang: getStoredLang(),
    onStatus: (s) =>
      handlers.onSpeaking?.(s === 'speaking' || s === 'paused'),
    onEnd: () => {
      if (activeSpeaking === handlers.onSpeaking) activeSpeaking = null
      handlers.onSpeaking?.(false)
    },
    onError: (msg) => {
      if (activeSpeaking === handlers.onSpeaking) activeSpeaking = null
      handlers.onSpeaking?.(false)
      handlers.onError?.(msg || 'Sesli okuma başarısız')
    },
  })
  return true
}

export function stopPdfSpeak() {
  stopSpeech()
  activeSpeaking?.(false)
  activeSpeaking = null
}
