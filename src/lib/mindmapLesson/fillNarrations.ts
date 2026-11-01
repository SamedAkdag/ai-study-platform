/**
 * Fill missing narrations from unit markdown — zero extra AI cost.
 * Teacher-style: hub roadmap → branch overview → leaf-specific detail.
 * Never emit homework-style meta prompts ("notlarından ayıkla…").
 */
import { buildMindMapTopicDetail } from '@/lib/mindMapTopicDetail'
import { markdownToSpeechText } from '@/lib/tts'
import type { MindMapData } from '@/types/database'
import type { NarratedMindMapData } from '@/lib/mindmapLesson/types'
import {
  clipNarration,
  narrationWordCount,
  narrationsComplete,
  validateNarratedMindMap,
} from '@/lib/mindmapLesson/validate'

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function sentencesOf(text: string): string[] {
  return norm(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)
}

function topicTokens(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

/** Expand a hit index to nearby sentence window. */
function windowAround(plain: string, idx: number, radius = 220): string {
  if (idx < 0) return ''
  let start = Math.max(0, plain.lastIndexOf('.', idx - 1) + 1)
  if (idx - start > radius) start = Math.max(0, idx - radius)
  let end = plain.indexOf('.', idx + 12)
  if (end < 0 || end - idx > radius * 1.4) {
    end = Math.min(plain.length, idx + radius)
  } else {
    end = Math.min(plain.length, end + 1)
  }
  return norm(plain.slice(start, end))
}

/** Find the best plain-text window for a leaf/branch label. */
function extractAroundLabel(
  markdown: string,
  topic: string,
  opts?: { maxChars?: number },
): string {
  const plain = markdownToSpeechText(String(markdown || ''))
  if (plain.length < 20) return ''
  const lower = plain.toLowerCase()
  const full = topic.toLowerCase().trim()
  let idx = full.length >= 4 ? lower.indexOf(full) : -1
  if (idx < 0) {
    const tokens = topicTokens(topic).sort((a, b) => b.length - a.length)
    for (const t of tokens) {
      const i = lower.indexOf(t)
      if (i >= 0) {
        idx = i
        break
      }
    }
  }
  if (idx < 0) return ''
  let out = windowAround(plain, idx, 240)
  // Append a second nearby sentence if short
  if (narrationWordCount(out) < 22 && idx + 40 < plain.length) {
    const more = windowAround(plain, idx + Math.min(80, out.length), 160)
    if (more && more !== out) out = norm(`${out} ${more}`)
  }
  return clipNarration(out, Math.ceil((opts?.maxChars ?? 400) / 5))
}

/** Pull plain paragraphs that mention the topic. */
function extractTopicPassages(
  markdown: string,
  topic: string,
  opts?: { excludeTopics?: string[]; maxChars?: number },
): string {
  const md = String(markdown || '')
  if (!md.trim()) return ''
  const tokens = topicTokens(topic)
  if (!tokens.length) return extractAroundLabel(md, topic, opts)

  const exclude = (opts?.excludeTopics ?? [])
    .flatMap((t) => topicTokens(t).filter((x) => x.length >= 4))
    .filter((t) => !tokens.includes(t))

  const plain = markdownToSpeechText(md)
  const chunks = plain
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((c) => norm(c))
    .filter((c) => c.length > 20)

  const scored = chunks
    .map((c) => {
      const lower = c.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (lower.includes(t)) score += t.length >= 6 ? 3 : 2
      }
      for (const e of exclude) {
        if (lower.includes(e) && score > 0) score -= 1
      }
      return { c, score }
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return extractAroundLabel(md, topic, opts)

  const picked: string[] = []
  let chars = 0
  const max = opts?.maxChars ?? 420
  for (const { c } of scored.slice(0, 6)) {
    if (picked.some((p) => p.includes(c.slice(0, 36)) || c.includes(p.slice(0, 36)))) {
      continue
    }
    picked.push(c)
    chars += c.length
    if (chars >= max || picked.length >= 3) break
  }
  return norm(picked.join(' '))
}

const META_JUNK =
  /notlarından ayıkla|kendi sözlerinle kur|tek cümlelik tanımını|ipucu olarak kullan|doğrudan uzun bir paragraf bulunamadı|aşağıdaki maddelerden ilerleyebilir|ayrı bir odak/i

function stripTitleEcho(speech: string, title: string): string {
  let s = norm(speech)
  const t = norm(title)
  if (s.toLowerCase().startsWith(t.toLowerCase())) {
    s = s.slice(t.length).replace(/^[\s.,;:\-–—]+/, '')
  }
  s = s
    .replace(/Bu başlık haritada şu alt noktalarla bağlı[.!]?\s*/gi, '')
    .replace(
      /Aşağıdaki maddelerden ilerleyebilir veya ünite anlatımında bu kavramı arayabilirsin[.!]?\s*/gi,
      '',
    )
    .replace(
      /Ünite notlarında bu başlığa doğrudan uzun bir paragraf bulunamadı[.!]?\s*/gi,
      '',
    )
    .replace(/Kartı ve bağlı dalları ipucu olarak kullan[.!]?\s*/gi, '')
    .replace(/Alt noktalar:\s*/gi, '')
    .replace(META_JUNK, '')
  return norm(s)
}

function tooSimilar(a: string, b: string): boolean {
  const sa = sentencesOf(a)
  const sb = new Set(sentencesOf(b).map((s) => s.toLowerCase().slice(0, 48)))
  if (!sa.length || !sb.size) return false
  let hit = 0
  for (const s of sa) {
    if (sb.has(s.toLowerCase().slice(0, 48))) hit += 1
  }
  return hit / sa.length >= 0.45
}

function sentenceAboutLeaf(parentNarration: string, label: string): string {
  const key = label.toLowerCase().slice(0, Math.min(16, label.length))
  if (key.length < 3) return ''
  for (const s of sentencesOf(parentNarration)) {
    if (s.toLowerCase().includes(key)) return s
  }
  // parent preview list often names children
  const preview = parentNarration.match(
    new RegExp(`(?:altında|gibi noktalar)[^.]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*\\.`, 'i'),
  )
  return preview?.[0] ? norm(preview[0]) : ''
}

function hubSpeech(
  central: string,
  branchLabels: string[],
  markdown: string,
  unitTitle: string,
): string {
  const detail = buildMindMapTopicDetail({
    label: central,
    kind: 'central',
    children: branchLabels,
    markdown,
    unitTitle,
  })
  let body = stripTitleEcho(
    markdownToSpeechText(detail.narrative || detail.speech),
    central,
  )
  body = extractTopicPassages(markdown, central, { maxChars: 380 }) || body
  body = stripTitleEcho(body, central)
  const list =
    branchLabels.length <= 2
      ? branchLabels.join(' ve ')
      : `${branchLabels.slice(0, -1).join(', ')} ve ${branchTitlesLast(branchLabels)}`
  const road =
    branchLabels.length > 0
      ? ` Bugün haritada ${list} başlıklarını sırayla işleyeceğiz.`
      : ''
  let out = norm(`${body}${road}`)
  if (narrationWordCount(out) < 28 || META_JUNK.test(out)) {
    out = norm(
      `${central}, bu ünitenin omurgası. ${road || 'Ana başlıkları birlikte gezeceğiz.'}`,
    )
  }
  return clipNarration(out, 110)
}

function branchTitlesLast(titles: string[]) {
  return titles[titles.length - 1]
}

function branchSpeech(
  label: string,
  children: string[],
  markdown: string,
  unitTitle: string,
  siblingLabels: string[],
): string {
  const passage =
    extractTopicPassages(markdown, label, {
      excludeTopics: siblingLabels.filter((s) => s !== label),
      maxChars: 360,
    }) || extractAroundLabel(markdown, label)

  const detail = buildMindMapTopicDetail({
    label,
    kind: 'branch',
    children,
    markdown,
    unitTitle,
  })
  let body = stripTitleEcho(
    passage || markdownToSpeechText(detail.narrative || detail.speech),
    label,
  )
  if (META_JUNK.test(body) || narrationWordCount(body) < 14) {
    body = extractAroundLabel(markdown, label) || body
    body = stripTitleEcho(body, label)
  }
  const preview =
    children.length > 0
      ? ` Bu başlığın altında ${children.slice(0, 4).join(', ')} gibi noktalar var; sırayla değineceğiz.`
      : ''
  let out = norm(`${body}${preview}`)
  if (narrationWordCount(body) < 14 || META_JUNK.test(out)) {
    out = norm(
      `${label}, ${unitTitle} içinde temel bir ana başlık. ${preview || 'Bu başlığı netleştirelim.'}`,
    )
  }
  return clipNarration(stripTitleEcho(out, label) || out, 100)
}

/**
 * Leaf narration: real notes content only — never study-coach homework lines.
 */
function leafSpeech(
  label: string,
  parentLabel: string,
  siblingLeaves: string[],
  markdown: string,
  unitTitle: string,
  parentNarration: string,
): string {
  const siblings = siblingLeaves.filter((s) => s !== label)

  // Prefer a tight window around the leaf label (avoids sibling bleed)
  let body = extractAroundLabel(markdown, label, { maxChars: 360 })
  if (!body || narrationWordCount(body) < 12) {
    body = extractTopicPassages(markdown, label, {
      excludeTopics: [parentLabel, ...siblings],
      maxChars: 280,
    })
  }

  if (!body || narrationWordCount(body) < 12) {
    const detail = buildMindMapTopicDetail({
      label,
      kind: 'leaf',
      markdown,
      unitTitle,
    })
    body = stripTitleEcho(
      markdownToSpeechText(detail.narrative || detail.speech),
      label,
    )
  }

  // Drop sentences that are clearly about a sibling leaf
  if (siblings.length && body) {
    const keep = sentencesOf(body).filter((s) => {
      const low = s.toLowerCase()
      const aboutSelf = topicTokens(label).some((t) => low.includes(t))
      const aboutSibling = siblings.some((sib) =>
        topicTokens(sib).some(
          (t) => t.length >= 5 && low.includes(t) && !topicTokens(label).includes(t),
        ),
      )
      return aboutSelf || !aboutSibling
    })
    if (keep.length) body = norm(keep.join(' '))
  }

  body = stripTitleEcho(body, label)

  if (tooSimilar(body, parentNarration) || META_JUNK.test(body) || narrationWordCount(body) < 12) {
    const around = extractAroundLabel(markdown, label)
    if (around && !META_JUNK.test(around) && !tooSimilar(around, parentNarration)) {
      body = stripTitleEcho(around, label)
    } else {
      const fromParent = sentenceAboutLeaf(parentNarration, label)
      if (fromParent && narrationWordCount(fromParent) >= 8) {
        body = fromParent
      }
    }
  }

  // Last resort: short factual bridge from map structure only (no coach prompts)
  if (!body || META_JUNK.test(body) || narrationWordCount(body) < 10) {
    body = norm(
      `${label}, ${parentLabel} başlığının bir alt öğesidir. ` +
        `${unitTitle} içinde ${label} bu dal altında yer alır.`,
    )
  }

  body = stripTitleEcho(body, label)
  if (META_JUNK.test(body)) {
    body = norm(`${label}, ${parentLabel} altında yer alan bir kavramdır.`)
  }

  // Lead with the leaf name once (avoid "Title. title: …" doubles)
  const lead = label.toLowerCase()
  const bodyLow = body.toLowerCase()
  if (!bodyLow.startsWith(lead.slice(0, Math.min(10, lead.length)))) {
    body = norm(`${label}. ${body}`)
  }
  // Collapse accidental "X. X:" / "X. X,"
  body = body.replace(
    new RegExp(
      `^(${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[.:,\\s]+\\1\\b`,
      'i',
    ),
    '$1',
  )
  return clipNarration(norm(body), 95)
}

function preferOrFill(
  existing: string | undefined,
  fill: () => string,
  minWords = 16,
): string {
  const t = existing?.replace(/\s+/g, ' ').trim()
  if (t && narrationWordCount(t) >= minWords && !META_JUNK.test(t)) {
    return clipNarration(t, 120)
  }
  return fill()
}

/**
 * Merge AI narrations (if any) with client-derived teacher speech for gaps.
 */
export function fillMindMapNarrations(
  data: MindMapData | NarratedMindMapData,
  markdown?: string | null,
  unitTitle?: string,
): NarratedMindMapData {
  const title = unitTitle || data.central || 'Ünite'
  const md = markdown || ''
  const branchLabels = (data.branches ?? []).map((b) => b.label)

  const pass = (): NarratedMindMapData => {
    const centralNarration = preferOrFill(
      (data as NarratedMindMapData).narration,
      () => hubSpeech(data.central, branchLabels, md, title),
      16,
    )

    const branches = (data.branches ?? []).map((b) => {
      const kids = b.children ?? []
      const existingKids = (b as NarratedMindMapData['branches'][0])
        .child_narrations
      const narration = preferOrFill(
        (b as { narration?: string }).narration,
        () => branchSpeech(b.label, kids, md, title, branchLabels),
        14,
      )
      const child_narrations = kids.map((child, i) => {
        const fromAi = existingKids?.[i]?.trim()
        // Reject stale meta fallbacks even if previously stored
        if (fromAi && narrationWordCount(fromAi) >= 10 && !META_JUNK.test(fromAi)) {
          return clipNarration(fromAi, 120)
        }
        return leafSpeech(child, b.label, kids, md, title, narration)
      })
      return {
        label: b.label,
        page: b.page ?? null,
        children: kids,
        narration,
        child_narrations,
      }
    })

    return {
      central: data.central,
      narration: clipNarration(centralNarration, 120),
      branches,
    }
  }

  let filled = pass()
  let checked = validateNarratedMindMap(filled)
  if (checked.ok && narrationsComplete(checked.data)) return checked.data
  if (narrationsComplete(filled)) return filled

  filled = pass()
  checked = validateNarratedMindMap(filled)
  return checked.ok ? checked.data : filled
}
