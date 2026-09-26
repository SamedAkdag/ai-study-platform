/**
 * Reject body-text fragments that look like fake "titles"
 * (legal sentences, money amounts, long clauses, etc.)
 */
export function isGarbageTitle(title: string): boolean {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length < 3 || t.length > 72) return true

  const lower = t.toLowerCase()

  // Page / content placeholders
  if (/content for pages|^pages?\s+\d+|^ünite \(s\.|^sayfa\s+\d+/i.test(t)) {
    return true
  }

  // Money / huge numbers / TL clauses (common PDF body noise)
  if (/\d{1,3}([.\s]\d{3}){2,}/.test(t)) return true // 1.500.000.000
  if (/\d[\d.\s]{6,}\s*(tl|try|usd|€|\$)/i.test(t)) return true
  if (/\b(tl|try)\b/i.test(t) && /\d/.test(t)) return true

  // Looks like a full sentence / legal obligation wording
  if (/zorunluluğu yoktur|bulunma zorun|hakkında hüküm|madde\s+\d+/i.test(t)) {
    return true
  }
  if (/[.!?]$/.test(t) && t.split(' ').length > 6) return true
  if (t.split(' ').length > 12) return true

  // Too many digits relative to letters
  const digits = (t.match(/\d/g) || []).length
  const letters = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length
  if (digits > 6 && digits >= letters) return true

  // Verb-heavy clause openings that are rarely headings
  if (
    /^(ancak|fakat|böylece|bununla birlikte|eğer|şayet|nedeniyle)\b/i.test(
      lower,
    )
  ) {
    return true
  }

  return false
}

export function cleanTopicLabel(title: string): string | null {
  const t = title.replace(/\s+/g, ' ').trim()
  if (!t || isGarbageTitle(t)) return null
  return t
}

export function cleanTopicList(items: string[], max = 6): string[] {
  const out: string[] = []
  for (const item of items) {
    const c = cleanTopicLabel(item)
    if (!c) continue
    if (out.some((x) => x.toLowerCase() === c.toLowerCase())) continue
    out.push(c)
    if (out.length >= max) break
  }
  return out
}
