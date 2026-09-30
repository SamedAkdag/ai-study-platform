/** Insert AI note directly under the last sentence of the user's selection. */
export function insertAiNoteAfterSelection(
  markdown: string,
  selectedText: string,
  question: string,
  answer: string,
): string {
  const q = question.replace(/\s+/g, ' ').trim().slice(0, 160)
  const safeAnswer = answer.trim() || '(boş yanıt)'
  const noteBody = [
    `> **AI notu** · _${escapeMdInline(q)}_`,
    ...safeAnswer.split('\n').map((line) => `> ${line}`),
  ].join('\n')

  const span = findSelectionSpan(markdown, selectedText)
  if (!span) {
    return `${markdown.trimEnd()}\n\n${noteBody}\n`
  }

  const { start, end } = span
  const selectedSlice = markdown.slice(start, end)
  const lastSentRel = offsetAfterLastSentence(selectedSlice)
  let insertAt = start + lastSentRel

  // Skip trailing spaces on that sentence, keep paragraph break clean
  while (insertAt < markdown.length && /[ \t]/.test(markdown[insertAt]!)) {
    insertAt += 1
  }

  const before = markdown.slice(0, insertAt).replace(/[ \t]+$/, '')
  let after = markdown.slice(insertAt)
  // Drop a single leading newline so we control spacing; keep rest of text
  if (after.startsWith('\r\n')) after = after.slice(2)
  else if (after.startsWith('\n')) after = after.slice(1)

  const needsLeadBreak = !before.endsWith('\n')
  const block = `${needsLeadBreak ? '\n\n' : '\n'}${noteBody}\n\n`

  return `${before}${block}${after}`
}

/** End offset (relative) right after the last sentence in `text`. */
function offsetAfterLastSentence(text: string): number {
  if (!text.trim()) return text.length

  // Sentence enders: . ! ? … and optional closing quotes/brackets
  const re = /[.!?…]["'"»)\]]*/g
  let lastEnd = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // Ignore decimals like 3.14 / 1.500
    const prev = m.index > 0 ? text[m.index - 1]! : ''
    const next = text[m.index + m[0].length] ?? ''
    if (m[0].startsWith('.') && /\d/.test(prev) && /\d/.test(next)) continue
    lastEnd = m.index + m[0].length
  }

  if (lastEnd < 0) return text.length
  return lastEnd
}

function findSelectionSpan(
  markdown: string,
  selectedText: string,
): { start: number; end: number } | null {
  const raw = selectedText.trim()
  if (!raw) return null

  // 1) Exact
  const exact = markdown.indexOf(selectedText)
  if (exact >= 0) {
    return { start: exact, end: exact + selectedText.length }
  }
  const exactTrim = markdown.indexOf(raw)
  if (exactTrim >= 0) {
    return { start: exactTrim, end: exactTrim + raw.length }
  }

  // 2) Flexible whitespace: build regex from selection tokens
  const tokens = raw.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const pattern = tokens.map(escapeRegExp).join('\\s+')
  const match = markdown.match(new RegExp(pattern))
  if (match && match.index != null) {
    return { start: match.index, end: match.index + match[0].length }
  }

  // 3) Leading snippet
  const snippet = raw.slice(0, Math.min(40, raw.length))
  const snippetIdx = markdown.indexOf(snippet)
  if (snippetIdx >= 0) {
    return { start: snippetIdx, end: snippetIdx + snippet.length }
  }

  return null
}

function escapeMdInline(s: string): string {
  return s.replace(/[_*`[\]]/g, '\\$&')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isAiNoteBlockquote(text: string): boolean {
  return /^\s*AI notu\b/i.test(text.trim()) || text.includes('AI notu')
}
