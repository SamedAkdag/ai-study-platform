const KEY = 'studium_tour_v1'

export type TourState = {
  completedAt: string | null
  skippedAt: string | null
}

function read(): TourState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { completedAt: null, skippedAt: null }
    const parsed = JSON.parse(raw) as Partial<TourState>
    return {
      completedAt: parsed.completedAt ?? null,
      skippedAt: parsed.skippedAt ?? null,
    }
  } catch {
    return { completedAt: null, skippedAt: null }
  }
}

function write(state: TourState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function shouldAutoStartTour(): boolean {
  const s = read()
  return !s.completedAt && !s.skippedAt
}

export function markTourCompleted() {
  write({ ...read(), completedAt: new Date().toISOString() })
}

export function markTourSkipped() {
  write({ ...read(), skippedAt: new Date().toISOString() })
}

export function resetTour() {
  write({ completedAt: null, skippedAt: null })
}
