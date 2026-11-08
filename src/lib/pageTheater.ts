/** Sentinel body while the page tear is open and AI is writing. */
export const THEATER_LOADING_BODY = '⟨studium-yazıyor⟩'

export const THEATER_PROMPTS = {
  summarize:
    'Seçili pasajı kısa ve net özetle. Madde işaretleri kullan; gereksiz uzatma.',
  explain:
    'Seçili pasajı bir öğrenciye açıkla: tanım, neden önemli, 1 günlük hayat benzetmesi.',
} as const

export function isTheaterLoadingBody(body?: string | null): boolean {
  return (body || '').trim() === THEATER_LOADING_BODY
}
