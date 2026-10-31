/**
 * Repair common LLM “almost GFM” tables so remark-gfm can render them.
 * - Expands collapsed one-line tables joined with `>` (blockquote noise)
 * - Strips `>` from table rows inside blockquotes
 * - Unwraps ``` fences that only contain a table
 * - Adds blank lines before/after table blocks
 * - Ensures leading/trailing pipes on rows
 * - Inserts |---|---| separator after a header when missing
 */
export function normalizeMarkdownTables(markdown: string): string {
  let md = String(markdown || '')
  md = unwrapTableOnlyFences(md)
  md = expandCollapsedPipeTables(md)
  md = stripBlockquoteFromTableLines(md)

  const lines = md.split(/\r?\n/)
  const out: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i] ?? ''

    if (isLooseTableRow(line) && !isSeparatorRow(line)) {
      line = ensurePipes(line)
    } else if (isLooseSeparator(line)) {
      line = ensureSeparatorPipes(line)
    }

    // Blank line before a new table (GFM needs a break after prose)
    if (
      isTableRow(line) &&
      out.length > 0 &&
      String(out[out.length - 1] ?? '').trim() !== '' &&
      !isTableRow(out[out.length - 1]) &&
      !isSeparatorRow(out[out.length - 1])
    ) {
      out.push('')
    }

    out.push(line)

    if (!isTableRow(line) || isSeparatorRow(line)) continue

    // Only the first row of a table can be a missing-separator header
    const prev = lastMeaningful(out, out.length - 1)
    if (prev && (isTableRow(prev) || isSeparatorRow(prev))) continue

    const nextRaw = lines[i + 1]
    const next =
      nextRaw != null
        ? isLooseSeparator(nextRaw)
          ? ensureSeparatorPipes(nextRaw)
          : nextRaw
        : undefined
    const afterRaw = lines[i + 2]
    const after =
      afterRaw != null
        ? isLooseTableRow(afterRaw) && !isSeparatorRow(afterRaw)
          ? ensurePipes(afterRaw)
          : afterRaw
        : undefined

    if (
      !next ||
      !(isTableRow(next) || isSeparatorRow(next) || isLooseTableRow(next))
    ) {
      continue
    }
    if (isSeparatorRow(next) || isLooseSeparator(next)) continue

    // header + data without separator
    if (
      after === undefined ||
      !String(after).trim() ||
      isTableRow(after) ||
      isLooseTableRow(after)
    ) {
      const cols = Math.max(splitCells(line).length, splitCells(next).length, 2)
      out.push(makeSeparator(cols))
    }
  }

  return ensureBlankLineAfterTables(out).join('\n')
}

/**
 * LLMs often dump a whole table on one line, joining rows with `>`:
 * `**Başlık** > > | A | B | > |---|---| > | 1 | 2 |`
 */
function expandCollapsedPipeTables(md: string): string {
  return md
    .split(/\r?\n/)
    .map((line) => expandCollapsedLine(line))
    .join('\n')
}

function expandCollapsedLine(line: string): string {
  if (!line.includes('|') || !line.includes('>')) return line

  // Need at least two pipe-groups separated by >
  const pipeHits = line.match(/\|/g)
  if (!pipeHits || pipeHits.length < 4) return line

  const parts = line.split(/\s*>+\s*/)
  if (parts.length < 2) return line

  const proseBefore: string[] = []
  const rows: string[] = []
  const after: string[] = []
  let phase: 'before' | 'table' | 'after' = 'before'

  for (const part of parts) {
    const t = String(part || '').trim()
    if (!t) continue
    const isRow =
      isTableRow(t) ||
      isLooseTableRow(t) ||
      isSeparatorRow(t) ||
      isLooseSeparator(t)

    if (phase === 'before') {
      if (isRow) {
        phase = 'table'
        rows.push(t)
      } else {
        proseBefore.push(t)
      }
    } else if (phase === 'table') {
      if (isRow) rows.push(t)
      else {
        phase = 'after'
        after.push(t)
      }
    } else {
      after.push(t)
    }
  }

  // Need header + at least separator or one data row
  if (rows.length < 2) return line

  const chunks: string[] = []
  if (proseBefore.length) chunks.push(proseBefore.join(' '))
  chunks.push(rows.join('\n'))
  if (after.length) chunks.push(after.join(' '))
  return chunks.join('\n\n')
}

/** `> | A | B |` blockquote-wrapped table rows → plain GFM rows. */
function stripBlockquoteFromTableLines(md: string): string {
  return md
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^(\s*>\s*)+(.*)$/)
      if (!m) return line
      const rest = String(m[2] || '').trim()
      if (
        isTableRow(rest) ||
        isLooseTableRow(rest) ||
        isSeparatorRow(rest) ||
        isLooseSeparator(rest)
      ) {
        return rest
      }
      return line
    })
    .join('\n')
}

/** ```…``` that is almost entirely a markdown table → unwrap so GFM can parse it. */
function unwrapTableOnlyFences(md: string): string {
  return md.replace(
    /```(?:markdown|md|gfm|text|table|plaintext)?\s*\r?\n([\s\S]*?)```/gi,
    (full, body: string) => {
      const lines = String(body || '')
        .replace(/^\s+|\s+$/g, '')
        .split(/\r?\n/)
      if (lines.length < 2) return full
      let tableish = 0
      for (const line of lines) {
        const t = line.trim()
        if (!t) {
          tableish += 1
          continue
        }
        if (
          isTableRow(t) ||
          isSeparatorRow(t) ||
          isLooseTableRow(t) ||
          isLooseSeparator(t)
        ) {
          tableish += 1
        }
      }
      if (tableish / lines.length >= 0.65) {
        return lines.join('\n')
      }
      return full
    },
  )
}

function ensureBlankLineAfterTables(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    out.push(line)
    const next = lines[i + 1]
    if (
      next != null &&
      String(next).trim() !== '' &&
      (isTableRow(line) || isSeparatorRow(line)) &&
      !isTableRow(next) &&
      !isSeparatorRow(next) &&
      !isLooseTableRow(next) &&
      !isLooseSeparator(next)
    ) {
      out.push('')
    }
  }
  return out
}

function isTableRow(line: string | undefined): boolean {
  if (line == null) return false
  const t = String(line).trim()
  if (/^!\[[^\]]*\]\(/.test(t)) return false
  if (!t.includes('|')) return false
  if (!/^\|.+\|/.test(t) && !/^\|?.+\|/.test(t)) return false
  const cells = splitCells(t)
  return cells.length >= 2
}

/** `A | B | C` without outer pipes — still a table row candidate. */
function isLooseTableRow(line: string | undefined): boolean {
  if (line == null) return false
  if (isTableRow(line)) return true
  const t = String(line).trim()
  if (/^!\[[^\]]*\]\(/.test(t)) return false
  if (!t.includes('|')) return false
  if (/^[:|\s-]+$/.test(t)) return false
  const cells = splitCells(t)
  // Long legal/exam cells are common — don't reject on length alone
  return cells.length >= 2 && cells.every((c) => c.length < 800)
}

function isSeparatorRow(line: string | undefined): boolean {
  if (line == null) return false
  const t = String(line).trim()
  if (!t.includes('|') && !t.includes('-')) return false
  const cells = splitCells(t)
  if (cells.length < 2) {
    return /^\|?[\s:|-]+\|?$/.test(t) && /-/.test(t)
  }
  return cells.every((c) => /^:?-{1,}:?$/.test(String(c ?? '').trim()))
}

function isLooseSeparator(line: string | undefined): boolean {
  if (line == null) return false
  if (isSeparatorRow(line)) return true
  const t = String(line).trim()
  if (!t.includes('-')) return false
  if (!/^[\s|:–—-]+$/.test(t)) return false
  return (t.match(/-{2,}/g) || []).length >= 2 || t.includes('|')
}

function ensurePipes(line: string): string {
  let t = String(line || '').trim()
  if (!t.startsWith('|')) t = `| ${t}`
  if (!t.endsWith('|')) t = `${t} |`
  return t
}

function ensureSeparatorPipes(line: string): string {
  const cells = splitCells(line)
  const n = Math.max(cells.length, 2)
  const parts =
    cells.length >= 2
      ? cells.map((c) => {
          const raw = String(c || '').trim()
          if (/^:?-{1,}:?$/.test(raw)) {
            if (raw.startsWith(':') && raw.endsWith(':')) return ':---:'
            if (raw.startsWith(':')) return ':---'
            if (raw.endsWith(':')) return '---:'
            return '---'
          }
          return '---'
        })
      : Array.from({ length: n }, () => '---')
  return `| ${parts.join(' | ')} |`
}

function splitCells(line: string): string[] {
  let t = String(line || '').trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => String(c ?? '').trim())
}

function makeSeparator(cols: number): string {
  return `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
}

function lastMeaningful(
  lines: string[],
  beforeIndex: number,
): string | undefined {
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const t = String(lines[i] ?? '').trim()
    if (t) return lines[i]
  }
  return undefined
}
