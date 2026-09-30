const MEMBER_KEY = 'studium_member_key'
const DISPLAY_NAME = 'studium_display_name'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

export function getOrCreateMemberKey(): string {
  try {
    const existing = localStorage.getItem(MEMBER_KEY)
    if (existing) return existing
    const next = randomId()
    localStorage.setItem(MEMBER_KEY, next)
    return next
  } catch {
    return randomId()
  }
}

export function getStoredDisplayName(): string {
  try {
    return localStorage.getItem(DISPLAY_NAME)?.trim() || ''
  } catch {
    return ''
  }
}

export function setStoredDisplayName(name: string) {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, 48)
  try {
    if (cleaned) localStorage.setItem(DISPLAY_NAME, cleaned)
  } catch {
    /* ignore */
  }
  return cleaned
}
