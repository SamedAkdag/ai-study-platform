/** One-shot coach tips — short, dismissible, localStorage-backed. */

const PREFIX = 'studium.coach.v1:'

export type CoachTipId =
  | 'study-desk'
  | 'need-units'
  | 'reader-select'
  | 'upload-done'

export function isCoachTipSeen(id: CoachTipId): boolean {
  try {
    return localStorage.getItem(PREFIX + id) === '1'
  } catch {
    return true
  }
}

export function markCoachTipSeen(id: CoachTipId) {
  try {
    localStorage.setItem(PREFIX + id, '1')
  } catch {
    /* ignore */
  }
}

export const COACH_COPY: Record<CoachTipId, string> = {
  'study-desk': 'Bir kart seç — veya PDF’den paragraf seçip AI’ya sor.',
  'need-units': 'Önce konuları ayıralım — tek dokunuş yeter.',
  'reader-select': 'Üst köşeden AI’a sor — veya paragrafa çift tıkla.',
  'upload-done': 'Kaynağın hazır. Ne yapmak istediğini seç.',
}
