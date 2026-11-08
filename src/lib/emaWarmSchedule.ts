/**
 * Idle-time EMA TTS prefetch — never blocks first paint.
 * Loads the heavy model only after the page is interactive / idle.
 */

let scheduled = false

function connectionLooksConstrained(): boolean {
  try {
    const nav = navigator as Navigator & {
      connection?: {
        saveData?: boolean
        effectiveType?: string
      }
    }
    const c = nav.connection
    if (!c) return false
    if (c.saveData) return true
    const t = String(c.effectiveType || '')
    return t === 'slow-2g' || t === '2g'
  } catch {
    return false
  }
}

function whenIdle(fn: () => void, timeoutMs: number) {
  const ric = (
    window as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        opts?: IdleRequestOptions,
      ) => number
    }
  ).requestIdleCallback
  if (typeof ric === 'function') {
    ric(() => fn(), { timeout: timeoutMs })
    return
  }
  window.setTimeout(fn, Math.min(1200, timeoutMs))
}

function startWarm() {
  // Dynamic import keeps ORT / EMA out of the critical path until idle.
  void import('@/lib/emaSpeak')
    .then((m) => m.warmEmaSpeak())
    .catch((err) => {
      console.info('[ema] background warm skipped', err)
    })
}

/**
 * Call once from app boot. Waits for window load + short settle, then idle.
 * Skips Save-Data / very slow networks so home open stays snappy.
 */
export function scheduleEmaBackgroundWarm() {
  if (scheduled || typeof window === 'undefined') return
  scheduled = true

  if (connectionLooksConstrained()) return

  const afterLoad = () => {
    // Let route data / paint settle before competing for bandwidth/CPU.
    window.setTimeout(() => {
      whenIdle(startWarm, 4000)
    }, 2500)
  }

  if (document.readyState === 'complete') {
    afterLoad()
  } else {
    window.addEventListener('load', afterLoad, { once: true })
  }
}
