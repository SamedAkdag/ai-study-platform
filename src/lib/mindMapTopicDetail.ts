import { markdownToSpeechText } from '@/lib/tts'

export type MindMapTopicDetail = {
  title: string
  kind: 'central' | 'branch' | 'leaf'
  /** Bullet points from map children (branch) */
  points: string[]
  /** Narrative pulled from study notes */
  narrative: string
  speech: string
}

function strip(md: string): string {
  return markdownToSpeechText(md).trim()
}

function paragraphs(md: string): string[] {
  return String(md || '')
    .split(/\n{2,}/)
    .map((p) => strip(p))
    .filter((p) => p.length > 40)
}

/** Score how well a paragraph matches topic tokens. */
function scorePara(para: string, tokens: string[]): number {
  const lower = para.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (t.length < 3) continue
    if (lower.includes(t)) score += t.length > 6 ? 3 : 2
  }
  return score
}

function tokensFrom(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

/**
 * Build a readable topic sheet for a mind-map node from notes + children.
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
    .slice(0, 8)

  const md = String(input.markdown || '')
  const paras = paragraphs(md)
  let narrative = ''

  if (input.kind === 'central') {
    narrative = paras.slice(0, 2).join('\n\n')
    if (!narrative && input.unitTitle) {
      narrative = `“${input.unitTitle}” ünitesinin omurgası. Haritadaki dallar bu merkez etrafında gruplanır.`
    }
  } else {
    const tokens = tokensFrom(title)
    const ranked = paras
      .map((p) => ({ p, s: scorePara(p, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)

    if (ranked.length) {
      narrative = ranked
        .slice(0, 2)
        .map((x) => x.p)
        .join('\n\n')
    }

    // Fallback: sentence containing the topic
    if (!narrative && md) {
      const plain = strip(md)
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

  // Keep panel readable
  if (narrative.length > 900) {
    narrative = `${narrative.slice(0, 880).trim()}…`
  }

  const speechParts = [
    title,
    narrative,
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
