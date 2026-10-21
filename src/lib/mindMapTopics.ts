/**
 * Turn a free-text mind-map node into a short TOPIC LABEL (NotebookLM-style).
 * Strips definition/trap sentences so the canvas maps subjects, not content.
 */
export function toTopicLabel(
  raw: string,
  opts?: { maxWords?: number; maxChars?: number },
): string {
  const maxWords = opts?.maxWords ?? 5
  const maxChars = opts?.maxChars ?? 36

  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''

  // Explicit title after a content-role prefix
  s = s.replace(
    /^(tanım|tanim|nasıl|nasil|ilişki|iliski|tuzak|sınav|sinav|örnek|ornek|dikkat|önemli|onemli|özet|ozet|kavram|formül|formul|adım|adim|süreç|surec|neden|ne)\s*[:：\-–]\s*/i,
    '',
  )

  const quoted = s.match(/^["“«]([^"”»]{2,48})["”»]/)
  if (quoted?.[1]) s = quoted[1].trim()

  // Cut explanatory tails
  s =
    s.split(
      /\s+(?:çünkü|zira|ancak|fakat|yani|örneğin|ornegin|bu nedenle|dolayısıyla|dolayisiyla)\s+/i,
    )[0] || s
  s = s.split(/[.!?;]/)[0] || s
  s = s.split(/\s+[—–]\s+/)[0] || s
  s = s.replace(/\s*\([^)]{0,80}\)\s*$/g, '').trim()

  const words = s.split(/\s+/).filter(Boolean)
  // Already a short heading — keep (TOC style)
  if (
    words.length <= maxWords &&
    s.length <= maxChars &&
    !/(?:dır|dir|tır|tir|çünkü|olan|için|icin)\b/i.test(s)
  ) {
    return s.replace(/^[\s\-–—:·]+|[\s\-–—:·,]+$/g, '').trim()
  }

  const looksSentence =
    words.length > maxWords ||
    /(?:dır|dir|tır|tir|dur|dür|tur|tür|abilir|ebilir|maktadır|mektedir|olur|eder|yapar|sağlar|saglar|içerir|icerir|anlamına|anlamina)\b/i.test(
      s,
    )

  if (looksSentence) {
    const dropLead = /^(bir|bu|şu|su|o|her|çok|cok|daha|en|ise|ise)$/i
    const picked: string[] = []
    for (const w of words) {
      if (picked.length === 0 && dropLead.test(w)) continue
      // Stop before soft clause words if we already have a label
      if (
        picked.length >= 2 &&
        /^(olan|olarak|için|icin|ile|ve|veya|gibi|kadar)$/i.test(w)
      ) {
        break
      }
      picked.push(w.replace(/[,\u2019']/g, ''))
      if (picked.length >= maxWords) break
    }
    s = picked.join(' ')
  }

  s = s.replace(/^[\s\-–—:·]+|[\s\-–—:·,]+$/g, '').trim()
  if (!s) return ''

  if (s.length > maxChars) {
    const cut = s.slice(0, maxChars)
    const sp = cut.lastIndexOf(' ')
    s = (sp > 10 ? cut.slice(0, sp) : cut).trim()
  }

  // Title-ish: keep as-is if already short; avoid trailing ellipsis on topics
  return s
}

export function normalizeMindMapTopics<
  T extends {
    central: string
    branches: Array<{ label: string; children?: string[]; page?: number | null }>
  },
>(data: T): T {
  const seen = new Set<string>()
  const branches = (data.branches ?? [])
    .map((b) => {
      // Preserve PDF TOC labels; only trim obvious sentence dumps
      const label = toTopicLabel(b.label, { maxWords: 8, maxChars: 52 })
      if (!label) return null
      const key = label.toLowerCase()
      if (seen.has(key)) return null
      seen.add(key)
      const childSeen = new Set<string>()
      const children = (b.children ?? [])
        .map((c) => toTopicLabel(c, { maxWords: 8, maxChars: 48 }))
        .filter((c) => {
          if (!c || c.toLowerCase() === key) return false
          const ck = c.toLowerCase()
          if (childSeen.has(ck)) return false
          childSeen.add(ck)
          return true
        })
        .slice(0, 8)
      return { ...b, label, children }
    })
    .filter(Boolean) as T['branches']

  return {
    ...data,
    central:
      toTopicLabel(data.central, { maxWords: 6, maxChars: 40 }) || data.central,
    branches,
  }
}
