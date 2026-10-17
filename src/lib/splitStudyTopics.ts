export type StudyTopic = {
  id: string
  title: string
  body: string
  summary: string
}

/** Only major H1/H2 — do not split ~5-page chapters into micro-sections. */
const MAJOR_HEADING = /^(#{1,2})\s+(.+)$/

/**
 * Light sectioning for study aids (guide / audio). Prefer one coherent unit;
 * never chunk a single chapter into numbered prose fragments.
 */
export function splitStudyTopics(
  markdown: string,
  fallbackTitle: string,
): StudyTopic[] {
  const md = String(markdown || '').trim()
  if (!md) return []

  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const sections: { title: string; body: string }[] = []
  let title = fallbackTitle || 'Konu'
  let buf: string[] = []
  let started = false

  const flush = () => {
    const body = buf.join('\n').trim()
    if (body.length > 24 || (!started && body)) {
      sections.push({ title, body })
    }
    buf = []
  }

  for (const line of lines) {
    const t = line.trim()
    const h = MAJOR_HEADING.exec(t)
    if (h) {
      const next = (h[2] || '').trim()
      if (next) {
        if (started || buf.some((l) => l.trim())) flush()
        title = next
        started = true
        continue
      }
    }
    buf.push(line)
  }
  flush()

  let usable = sections.filter((s) => s.body.length > 24)
  if (usable.length === 0 && md) {
    usable = [{ title: fallbackTitle || 'Konu', body: md }]
  }

  // Too many tiny H2 slices → keep as one clear chapter reading
  if (usable.length > 6) {
    usable = [{ title: fallbackTitle || 'Konu', body: md }]
  }

  return usable.map((s, i) => ({
    id: `t-${i}-${slug(s.title)}`,
    title: s.title,
    body: s.body,
    summary: makeSummary(s.body),
  }))
}

function slug(s: string): string {
  return (
    s
      .toLocaleLowerCase('tr')
      .replace(/[^a-z0-9çğıöşü]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'konu'
  )
}

function makeSummary(body: string): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|[^\n]+\|/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const parts = plain.split(/(?<=[.!?…])\s+/).filter((p) => p.length > 20)
  const pick = parts.slice(0, 3)
  if (pick.length === 0) {
    return plain.slice(0, 180) + (plain.length > 180 ? '…' : '')
  }
  const joined = pick.join(' ')
  return joined.length > 320 ? `${joined.slice(0, 317)}…` : joined
}
