/**
 * Repair common LLM “almost GFM” tables so remark-gfm can render them.
 * Inserts a |---|---| separator after a header row when missing.
 */
export function normalizeMarkdownTables(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const out: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    out.push(line)

    if (!isTableRow(line)) continue
    const next = lines[i + 1]
    const after = lines[i + 2]
    if (!next || !isTableRow(next)) continue
    if (isSeparatorRow(next)) continue
    // header + data without separator
    if (isTableRow(after) || after === undefined || after.trim() === '') {
      const cols = splitCells(line).length
      if (cols >= 2) {
        out.push(makeSeparator(cols))
      }
    }
  }

  return out.join('\n')
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  // Reject plain prose that happens to contain a pipe
  if (!/^\|?.+\|/.test(t)) return false
  const cells = splitCells(t)
  return cells.length >= 2
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|') && !t.includes('-')) return false
  const cells = splitCells(t)
  if (cells.length < 2) {
    // |---|---| form
    return /^\|?[\s:|-]+\|?$/.test(t) && /-/.test(t)
  }
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()))
}

function splitCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function makeSeparator(cols: number): string {
  return `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
}
