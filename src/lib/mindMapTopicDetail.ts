import { markdownToSpeechText } from '@/lib/tts'
import { normalizeMarkdownTables } from '@/lib/normalizeMarkdownTables'

export type MindMapTopicDetail = {
  title: string
  kind: 'central' | 'branch' | 'leaf'
  /** Bullet points from map children (branch) */
  points: string[]
  /**
   * Markdown body for the detail panel (may include GFM tables).
   * Render with StudyMarkdown.
   */
  narrative: string
  speech: string
}

type Block =
  | { type: 'prose'; md: string; plain: string }
  | { type: 'table'; md: string; plain: string }

function strip(md: string): string {
  return markdownToSpeechText(md).trim()
}

function isTableLine(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(t)) return true
  const pipes = (t.match(/\|/g) || []).length
  return pipes >= 1 && /\|/.test(t.slice(1))
}

/** Split unit markdown into prose paragraphs and table blocks (keep GFM). */
function splitBlocks(raw: string): Block[] {
  const md = normalizeMarkdownTables(String(raw || ''))
  const lines = md.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      i += 1
      continue
    }

    if (isTableLine(line)) {
      const start = i
      i += 1
      while (i < lines.length && isTableLine(lines[i] ?? '')) i += 1
      // Trailing blank after table is fine
      const chunk = lines.slice(start, i).join('\n').trim()
      if (chunk) {
        blocks.push({ type: 'table', md: chunk, plain: strip(chunk) })
      }
      continue
    }

    const start = i
    i += 1
    while (i < lines.length) {
      const n = lines[i] ?? ''
      if (!n.trim()) break
      if (isTableLine(n)) break
      i += 1
    }
    const chunk = lines.slice(start, i).join('\n').trim()
    if (chunk) {
      const plain = strip(chunk)
      if (plain.length > 24) {
        blocks.push({ type: 'prose', md: chunk, plain })
      }
    }
  }

  return blocks
}

/** Score how well a block matches topic tokens. */
function scoreBlock(plain: string, tokens: string[]): number {
  const lower = plain.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (t.length < 3) continue
    if (lower.includes(t)) score += t.length > 6 ? 3 : 2
  }
  // Prefer tables slightly when they mention the topic (comparison grids)
  return score
}

function tokensFrom(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

function trimNarrative(md: string, max = 1400): string {
  if (md.length <= max) return md
  // Prefer cutting after a table / paragraph break
  const cut = md.slice(0, max)
  const lastBreak = Math.max(
    cut.lastIndexOf('\n\n'),
    cut.lastIndexOf('\n|'),
  )
  if (lastBreak > max * 0.55) return `${cut.slice(0, lastBreak).trim()}\n\n…`
  return `${cut.trim()}…`
}

/**
 * Build a readable topic sheet for a mind-map node from notes + children.
 * Preserves markdown tables for StudyMarkdown rendering.
 */
export function buildMindMapTopicDetail(input: {
  label: string
  kind: 'central' | 'branch' | 'leaf'
  children?: string[]
  markdown?: string | null
  unitTitle?: string
}): MindMapTopicDetail {
  const title = input.label.replace(/\s+/g, ' ').trim() || 'Konu'
  const points = (input.children ?? [])
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12)

  const blocks = splitBlocks(input.markdown || '')
  let narrative = ''

  if (input.kind === 'central') {
    const picked = blocks.slice(0, 3)
    narrative = picked.map((b) => b.md).join('\n\n')
    if (!narrative && input.unitTitle) {
      narrative = `“${input.unitTitle}” ünitesinin omurgası. Haritadaki dallar bu merkez etrafında gruplanır.`
    }
  } else {
    const tokens = tokensFrom(title)
    const ranked = blocks
      .map((b) => ({
        b,
        s: scoreBlock(b.plain, tokens) + (b.type === 'table' ? 1 : 0),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)

    if (ranked.length) {
      // Prefer mixing: first hit + any strong table
      const top = ranked.slice(0, 2).map((x) => x.b)
      const tableBonus = ranked.find(
        (x) => x.b.type === 'table' && !top.includes(x.b) && x.s >= 3,
      )
      const chosen = tableBonus ? [...top.slice(0, 1), tableBonus.b] : top
      narrative = chosen.map((b) => b.md).join('\n\n')
    }

    if (!narrative && input.markdown) {
      const plain = strip(input.markdown)
      const idx = plain.toLowerCase().indexOf(title.toLowerCase().slice(0, 48))
      if (idx >= 0) {
        const start = Math.max(0, plain.lastIndexOf('.', idx) + 1)
        const end = Math.min(plain.length, idx + 420)
        narrative = plain.slice(start, end).trim()
      }
    }

    if (!narrative) {
      if (points.length) {
        narrative =
          'Bu başlık haritada şu alt noktalarla bağlı. Aşağıdaki maddelerden ilerleyebilir veya ünite anlatımında bu kavramı arayabilirsin.'
      } else {
        narrative =
          'Ünite notlarında bu başlığa doğrudan uzun bir paragraf bulunamadı. Kartı ve bağlı dalları ipucu olarak kullan.'
      }
    }
  }

  narrative = trimNarrative(narrative)

  const speechParts = [
    title,
    strip(narrative),
    points.length ? `Alt noktalar: ${points.join('. ')}` : '',
  ].filter(Boolean)

  return {
    title,
    kind: input.kind,
    points,
    narrative,
    speech: speechParts.join('. '),
  }
}
