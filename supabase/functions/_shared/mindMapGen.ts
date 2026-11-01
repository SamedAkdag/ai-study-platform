/** Shared mind-map parse / atlas helpers for chapter generation. */

export type PageSource = { page: number; topics: string[]; excerpt: string }
export type Page = { page: number; text: string }
export type MindMap = {
  central: string
  /** Optional guided-lesson speech (same call; client fills gaps) */
  narration?: string
  branches: Array<{
    label: string
    children?: string[]
    page?: number
    narration?: string
    child_narrations?: string[]
  }>
}

/** Compress a sentence/dump into a short topic heading. */
export function toTopicLabel(
  raw: string,
  maxWords = 5,
  maxChars = 36,
): string {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''

  s = s.replace(
    /^(tanım|tanim|nasıl|nasil|ilişki|iliski|tuzak|sınav|sinav|örnek|ornek|dikkat|önemli|onemli|özet|ozet|kavram|formül|formul|adım|adim|süreç|surec|neden|ne)\s*[:：\-–]\s*/i,
    '',
  )
  const quoted = s.match(/^["“«]([^"”»]{2,48})["”»]/)
  if (quoted?.[1]) s = quoted[1].trim()

  s =
    s.split(
      /\s+(?:çünkü|zira|ancak|fakat|yani|örneğin|ornegin|bu nedenle|dolayısıyla|dolayisiyla)\s+/i,
    )[0] || s
  s = s.split(/[.!?;]/)[0] || s
  s = s.split(/\s+[—–]\s+/)[0] || s
  s = s.replace(/\s*\([^)]{0,80}\)\s*$/g, '').trim()

  const words = s.split(/\s+/).filter(Boolean)
  // Short heading already — leave as TOC label
  if (
    words.length <= maxWords &&
    s.length <= maxChars &&
    !/(?:dır|dir|tır|tir|çünkü|olan|için|icin)\b/i.test(s)
  ) {
    return s.replace(/^[\s\-–—:·]+|[\s\-–—:·,]+$/g, '').trim()
  }

  const looksSentence =
    words.length > maxWords ||
    /(?:dır|dir|tır|tir|dur|dür|tur|tür|abilir|ebilir|mektedir|mektedir|olur|eder|yapar|sağlar|saglar|içerir|icerir|anlamına|anlamina)\b/i.test(
      s,
    )

  if (looksSentence) {
    const dropLead = /^(bir|bu|şu|su|o|her|çok|cok|daha|en)$/i
    const picked: string[] = []
    for (const w of words) {
      if (picked.length === 0 && dropLead.test(w)) continue
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
  return s
}

export function parseMindMap(
  raw: unknown,
  fallbackCentral: string,
): MindMap | null {
  if (!raw || typeof raw !== 'object') return null
  const mm = raw as { central?: unknown; branches?: unknown }
  const central =
    toTopicLabel(
      typeof mm.central === 'string' && mm.central.trim()
        ? mm.central.trim()
        : fallbackCentral,
      5,
      36,
    ) || fallbackCentral.slice(0, 36)
  const hubNarration =
    typeof (mm as { narration?: unknown }).narration === 'string'
      ? String((mm as { narration: string }).narration)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 900)
      : undefined
  const seen = new Set<string>()
  const branches: MindMap['branches'] = []
  if (Array.isArray(mm.branches)) {
    for (const b of mm.branches) {
      if (!b || typeof b !== 'object') continue
      const row = b as {
        label?: unknown
        children?: unknown
        page?: unknown
        narration?: unknown
        child_narrations?: unknown
      }
      const label = toTopicLabel(String(row.label || ''), 6, 40)
      if (!label) continue
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const childSeen = new Set<string>()
      const children: string[] = []
      if (Array.isArray(row.children)) {
        for (const c of row.children) {
          const cl =
            typeof c === 'object' && c
              ? String((c as { label?: unknown }).label || '').trim()
              : String(c || '').trim()
          const topic = toTopicLabel(cl, 4, 32)
          const ck = topic.toLowerCase()
          if (!topic || ck === key || childSeen.has(ck)) continue
          if (
            /^(giriş|özet|ozet|tanımlar|tanimlar|uygulama|sonuç|sonuc|genel)$/i.test(
              topic,
            )
          ) {
            continue
          }
          childSeen.add(ck)
          children.push(topic)
          if (children.length >= 6) break
        }
      }
      const pageNum = Number(row.page)
      const page =
        Number.isFinite(pageNum) && pageNum >= 1
          ? Math.round(pageNum)
          : undefined
      const narration =
        typeof row.narration === 'string'
          ? row.narration.replace(/\s+/g, ' ').trim().slice(0, 900)
          : undefined
      const child_narrations = Array.isArray(row.child_narrations)
        ? row.child_narrations
            .map((x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 900))
            .slice(0, children.length)
        : undefined
      branches.push({
        label,
        children,
        ...(page ? { page } : {}),
        ...(narration && narration.length >= 20 ? { narration } : {}),
        ...(child_narrations?.length ? { child_narrations } : {}),
      })
      if (branches.length >= 16) break
    }
  }
  return branches.length >= 1
    ? {
        central,
        ...(hubNarration && hubNarration.length >= 20
          ? { narration: hubNarration }
          : {}),
        branches,
      }
    : null
}

export function mindMapFallback(
  title: string,
  concepts: string[],
): MindMap {
  const labels =
    concepts.length >= 2
      ? concepts.slice(0, 6)
      : ['Temel kavramlar', 'İlişkiler', 'Uygulama']
  return {
    central: toTopicLabel(title, 5, 36) || title.slice(0, 36),
    branches: labels.map((label) => ({
      label: toTopicLabel(label, 6, 40) || label.slice(0, 40),
      children: [],
    })),
  }
}

const SKIP_HEADING =
  /^(özet|ozet|sınav kartı|sinav kartı|sık yapılan|anahtar noktalar|neden önemli|günlük hayattan|adım adım|bölüm\s*\d+|detay\s*\d+)/i

function cleanHeading(raw: string): string {
  return String(raw || '')
    .replace(/[#*_`]/g, '')
    .replace(/\s*\(s\.\s*\d+[^)]*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Flat heading inventory for the LLM user prompt (coverage aid). */
export function extractHeadingInventory(markdown: string): string {
  const lines: string[] = []
  for (const line of String(markdown || '').split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    const h3 = line.match(/^###\s+(.+?)\s*$/)
    if (h2) {
      const label = cleanHeading(h2[1] || '')
      if (!label || SKIP_HEADING.test(label)) continue
      lines.push(`H2: ${label}`)
    } else if (h3) {
      const label = cleanHeading(h3[1] || '')
      if (!label || SKIP_HEADING.test(label)) continue
      lines.push(`  H3: ${label}`)
    }
  }
  return lines.length ? lines.join('\n') : '(markdown başlığı yok)'
}

function looksLikePdfHeading(line: string): boolean {
  const s = line.replace(/\s+/g, ' ').trim()
  if (s.length < 3 || s.length > 90) return false
  if (/https?:\/\//i.test(s)) return false
  if (/^\d+$/.test(s)) return false
  if (/^[•·\-–—*]\s/.test(s)) return false
  // Skip obvious body sentences
  if (/\b(çünkü|ancak|fakat|şöyle ki|olarak kabul|görülür|edilir)\b/i.test(s)) {
    return false
  }
  if (/[.!?]{2,}/.test(s)) return false
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 14) return false

  // Numbered textbook headings: 3.1 Title / 3.1.2 Title
  if (/^(\d+\.)+\d*\s+\S/.test(s)) return true
  if (/^(bölüm|bolum|chapter|unit|section|kısım|kisim)\b/i.test(s)) return true
  // Short line without sentence end → likely heading
  if (!/[.!?]$/.test(s) && words.length <= 10) return true
  // ALL-CAPS short headings
  const letters = s.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')
  if (
    letters.length >= 4 &&
    letters === letters.toUpperCase() &&
    words.length <= 12
  ) {
    return true
  }
  return false
}

function pdfHeadingLevel(line: string): number {
  const m = line.match(/^((\d+\.)+\d*)\s+/)
  if (m?.[1]) {
    const depth = m[1].replace(/\.$/, '').split('.').filter(Boolean).length
    return Math.min(Math.max(depth, 1), 3)
  }
  if (/^(bölüm|bolum|chapter|unit)\b/i.test(line)) return 1
  return 2
}

function cleanPdfHeadingLabel(line: string): string {
  let s = cleanHeading(line)
  // Keep "3.1 Title" readable but cap length
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 52) s = s.slice(0, 50).trim()
  return toTopicLabel(s, 8, 52) || s.slice(0, 52)
}

export type PdfTocCandidate = {
  page: number
  level: number
  label: string
}

/** Scan raw PDF page_text for heading-like lines (NotebookLM-style source). */
export function extractPdfTocCandidates(pageText: string): PdfTocCandidate[] {
  const pages = splitPageText(pageText)
  const out: PdfTocCandidate[] = []
  const seen = new Set<string>()

  for (const p of pages) {
    if (!p.page || p.page < 1 || !p.text?.trim()) continue
    const rawLines = p.text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    // Prefer top of page (titles cluster there) then a light mid scan
    const scan = [
      ...rawLines.slice(0, 40),
      ...rawLines.slice(40, 90).filter((l) => looksLikePdfHeading(l)),
    ]
    for (const line of scan) {
      if (!looksLikePdfHeading(line)) continue
      const label = cleanPdfHeadingLabel(line)
      if (!label || SKIP_HEADING.test(label)) continue
      const key = `${p.page}:${label.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        page: p.page,
        level: pdfHeadingLevel(line),
        label,
      })
      if (out.length >= 100) return out
    }
  }
  return out
}

export function formatPdfTocCandidates(cands: PdfTocCandidate[]): string {
  if (!cands.length) return '(PDF başlık adayı yok)'
  return cands
    .map((c) => `s.${c.page} L${c.level}: ${c.label}`)
    .join('\n')
}

/**
 * Deterministic TOC from PDF headings + page_sources topics.
 * Primary path for NotebookLM-like maps.
 */
export function buildMindMapFromPdf(
  title: string,
  pageText: string,
  pageSources: PageSource[] = [],
): MindMap | null {
  const cands = extractPdfTocCandidates(pageText)
  type Branch = { label: string; children: string[]; page: number }
  const branches: Branch[] = []
  let cur: Branch | null = null

  const pushBranch = (label: string, page: number) => {
    const exists = branches.find(
      (b) => b.label.toLowerCase() === label.toLowerCase(),
    )
    if (exists) {
      cur = exists
      return
    }
    cur = { label, children: [], page }
    branches.push(cur)
  }

  const pushChild = (label: string) => {
    if (!cur) return
    if (label.toLowerCase() === cur.label.toLowerCase()) return
    if (!cur.children.some((c) => c.toLowerCase() === label.toLowerCase())) {
      cur.children.push(label)
    }
  }

  if (cands.length >= 2) {
    for (const c of cands) {
      if (c.level <= 1) {
        pushBranch(c.label, c.page)
      } else if (cur) {
        pushChild(c.label)
      } else {
        pushBranch(c.label, c.page)
      }
    }
  }

  // page_sources: first topic = ana başlık (if missing), rest = alt başlık
  for (const src of pageSources) {
    const topics = (src.topics ?? [])
      .map((t) => toTopicLabel(String(t), 6, 40))
      .filter(Boolean)
    if (!topics.length) continue

    let branch = branches.find((b) => b.page === src.page)
    if (!branch) {
      const label = topics[0]!
      const existing = branches.find(
        (b) => b.label.toLowerCase() === label.toLowerCase(),
      )
      if (existing) branch = existing
      else {
        branch = { label, children: [], page: src.page }
        branches.push(branch)
      }
    }
    for (const t of topics) {
      if (t.toLowerCase() === branch.label.toLowerCase()) continue
      if (!branch.children.some((c) => c.toLowerCase() === t.toLowerCase())) {
        branch.children.push(t)
      }
      if (branch.children.length >= 6) break
    }
  }

  // If almost no children, promote consecutive same-page candidates
  if (
    branches.length >= 2 &&
    branches.filter((b) => b.children.length > 0).length < 2
  ) {
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i]!
      if (b.children.length) continue
      const next = branches[i + 1]
      if (next && next.page === b.page) {
        b.children.push(next.label)
      }
    }
  }

  const usable = branches
    .filter((b) => b.label)
    .slice(0, 16)
    .map((b) => ({
      label: b.label,
      children: b.children.slice(0, 6),
      page: b.page,
    }))

  if (usable.length < 2) return null
  return {
    central: toTopicLabel(title, 5, 36) || title.slice(0, 36),
    branches: usable,
  }
}

/** Compact PDF body for LLM (per-page head slices). */
export function packPageTextForMindMap(
  pageText: string,
  maxTotal = 10_000,
): string {
  const pages = splitPageText(pageText).filter((p) => p.page >= 1)
  if (!pages.length) return ''
  const per = Math.max(180, Math.floor(maxTotal / pages.length))
  return pages
    .map((p) => {
      const body = p.text.replace(/\s+/g, ' ').trim().slice(0, per)
      return `=== s.${p.page} ===\n${body}`
    })
    .join('\n\n')
    .slice(0, maxTotal)
}

/**
 * Build a simple TOC mind map: ## = ana başlık, ### = alt başlık;
 * empty branches filled from page_sources topics.
 */
export function buildOutlineMindMap(
  title: string,
  markdown: string,
  pageSources: PageSource[] = [],
): MindMap | null {
  type Branch = { label: string; children: string[]; page?: number }
  const branches: Branch[] = []
  let cur: Branch | null = null

  for (const line of String(markdown || '').split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    const h3 = line.match(/^###\s+(.+?)\s*$/)
    if (h2) {
      const raw = cleanHeading(h2[1] || '')
      const label = toTopicLabel(raw, 6, 40)
      if (!label || SKIP_HEADING.test(label)) {
        cur = null
        continue
      }
      const pm = String(h2[1]).match(/s\.\s*(\d+)/i)
      cur = {
        label,
        children: [],
        ...(pm ? { page: Number(pm[1]) } : {}),
      }
      branches.push(cur)
      continue
    }
    if (h3 && cur) {
      const label = toTopicLabel(cleanHeading(h3[1] || ''), 5, 32)
      if (
        !label ||
        SKIP_HEADING.test(label) ||
        label.toLowerCase() === cur.label.toLowerCase()
      ) {
        continue
      }
      if (!cur.children.some((c) => c.toLowerCase() === label.toLowerCase())) {
        cur.children.push(label)
      }
    }
  }

  // Attach page topics as alt başlık under matching / nearest branch
  for (const src of pageSources) {
    const topics = (src.topics ?? [])
      .map((t) => toTopicLabel(String(t), 4, 32))
      .filter(Boolean)
    if (!topics.length) continue

    let branch =
      branches.find((b) => b.page === src.page) ||
      branches.find(
        (b) =>
          !b.page &&
          topics.some(
            (t) =>
              b.label.toLowerCase().includes(t.toLowerCase()) ||
              t.toLowerCase().includes(b.label.toLowerCase().slice(0, 12)),
          ),
      )

    if (!branch) {
      const label = topics[0]!
      if (branches.some((b) => b.label.toLowerCase() === label.toLowerCase())) {
        branch = branches.find(
          (b) => b.label.toLowerCase() === label.toLowerCase(),
        )!
      } else {
        branch = {
          label,
          children: [],
          page: src.page,
        }
        branches.push(branch)
      }
    }

    if (!branch.page) branch.page = src.page
    for (const t of topics) {
      if (t.toLowerCase() === branch.label.toLowerCase()) continue
      if (!branch.children.some((c) => c.toLowerCase() === t.toLowerCase())) {
        branch.children.push(t)
      }
      if (branch.children.length >= 5) break
    }
  }

  // Last resort: one branch per page
  if (branches.length < 3 && pageSources.length >= 2) {
    const fromPages: Branch[] = []
    for (const src of pageSources.slice(0, 12)) {
      const topics = (src.topics ?? [])
        .map((t) => toTopicLabel(String(t), 4, 32))
        .filter(Boolean)
      if (!topics.length) continue
      fromPages.push({
        label: topics[0]!,
        page: src.page,
        children: topics.slice(1, 5),
      })
    }
    if (fromPages.length >= 3) {
      return {
        central: toTopicLabel(title, 5, 36) || title.slice(0, 36),
        branches: fromPages,
      }
    }
  }

  const usable = branches
    .filter((b) => b.label)
    .slice(0, 12)
    .map((b) => ({
      label: b.label,
      children: b.children.slice(0, 6),
      ...(b.page ? { page: b.page } : {}),
    }))

  if (usable.length < 2) return null
  return {
    central: toTopicLabel(title, 5, 36) || title.slice(0, 36),
    branches: usable,
  }
}

/** Prefer coverage-rich TOC; LLM wins when it has solid headings+subs. */
export function pickBetterMindMap(
  outline: MindMap | null,
  llm: MindMap | null,
): MindMap | null {
  if (!outline && !llm) return null
  if (!outline) return llm
  if (!llm) return outline

  const score = (m: MindMap) => {
    let s = m.branches.length * 3
    let filled = 0
    for (const b of m.branches) {
      const kids = b.children ?? []
      if (kids.length >= 2) filled += 1
      s += Math.min(kids.length, 6) * 2
      for (const c of kids) {
        if (c.length > 40) s -= 3
        if (/\b(dır|dir|çünkü|olan|için)\b/i.test(c)) s -= 3
        if (c.split(/\s+/).length <= 6) s += 1
      }
    }
    s += filled * 4
    return s
  }

  // Trust a substantial LLM tree over a thin auto-outline
  const llmFilled = llm.branches.filter(
    (b) => (b.children?.length ?? 0) >= 2,
  ).length
  if (llm.branches.length >= 6 && llmFilled >= 4) return llm
  if (llm.branches.length > outline.branches.length + 1 && llmFilled >= 3) {
    return llm
  }

  return score(llm) >= score(outline) ? llm : outline
}

export function cleanExcerpt(text: string, max = 220): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function scorePageMatch(label: string, src: PageSource): number {
  const needle = label.toLowerCase()
  const tokens = needle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  if (!tokens.length) return 0
  let score = 0
  for (const topic of src.topics ?? []) {
    const t = String(topic).toLowerCase()
    for (const tok of tokens) {
      if (t.includes(tok)) score += tok.length >= 6 ? 4 : 2
    }
  }
  const ex = String(src.excerpt || '').toLowerCase()
  for (const tok of tokens) {
    if (ex.includes(tok)) score += tok.length >= 6 ? 2 : 1
  }
  return score
}

export function enrichMindMapCoverage(
  map: MindMap,
  pageSources: PageSource[],
  pageNums: number[],
): MindMap {
  if (!map.branches.length) return map
  const pages =
    pageNums.length > 0
      ? pageNums
      : pageSources.map((s) => s.page).filter((p) => p >= 1)
  if (!pages.length) return map

  const used = new Set<number>()
  const branches = map.branches.map((b) => {
    let page = b.page
    if (!(typeof page === 'number' && page >= 1)) {
      let bestPage: number | undefined
      let bestScore = 0
      for (const src of pageSources) {
        const s = scorePageMatch(b.label, src)
        if (s > bestScore) {
          bestScore = s
          bestPage = src.page
        }
      }
      if (bestPage && bestScore >= 2) page = bestPage
    }
    if (typeof page === 'number' && page >= 1) used.add(page)
    return { ...b, ...(page ? { page } : {}) }
  })

  const unused = pages.filter((p) => !used.has(p))
  if (unused.length > 0) {
    const counts = new Map<number, number>()
    for (const b of branches) {
      if (b.page) counts.set(b.page, (counts.get(b.page) || 0) + 1)
    }
    let ui = 0
    for (const b of branches) {
      if (ui >= unused.length) break
      if (!b.page) {
        b.page = unused[ui++]
        continue
      }
      if ((counts.get(b.page) || 0) > 2) {
        counts.set(b.page, (counts.get(b.page) || 1) - 1)
        b.page = unused[ui++]
      }
    }
  }

  branches.sort((a, b) => (a.page || 9999) - (b.page || 9999))
  return { ...map, branches }
}

export function sampleBalancedNotes(
  markdown: string,
  maxChars: number,
): string {
  const text = String(markdown || '').trim()
  if (!text) return ''
  if (text.length <= maxChars) return text
  const parts = text.split(/(?=^## )/m).filter((p) => p.trim())
  if (parts.length <= 1) {
    const head = Math.floor(maxChars * 0.45)
    const midStart = Math.floor(text.length / 2 - maxChars * 0.2)
    const mid = text.slice(
      Math.max(0, midStart),
      Math.max(0, midStart) + Math.floor(maxChars * 0.3),
    )
    const tail = text.slice(-Math.floor(maxChars * 0.25))
    return `${text.slice(0, head)}\n…\n${mid}\n…\n${tail}`
  }
  const per = Math.max(120, Math.floor(maxChars / parts.length))
  return parts
    .map((p) => (p.length <= per ? p.trim() : `${p.trim().slice(0, per)}…`))
    .join('\n\n')
    .slice(0, maxChars)
}

export function splitPageText(pageText: string): Page[] {
  const parts = pageText.split(/---\s*Page\s+(\d+)\s*---/i)
  const pages: Page[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const page = Number(parts[i])
    const text = (parts[i + 1] || '').trim()
    if (Number.isFinite(page)) pages.push({ page, text })
  }
  if (pages.length === 0 && pageText.trim()) {
    pages.push({ page: 0, text: pageText.trim() })
  }
  return pages
}

export function buildPageAtlas(
  pageText: string,
  pageSources: PageSource[],
  maxPages = 28,
): string {
  const byPage = new Map<number, PageSource>()
  for (const s of pageSources) byPage.set(s.page, s)
  const split = splitPageText(pageText)
  const pages =
    split.length > 0
      ? split.map((p) => p.page)
      : pageSources.map((s) => s.page)
  const unique = [...new Set(pages.filter((p) => p >= 1))].sort((a, b) => a - b)
  if (!unique.length) return '(atlas yok)'

  const step = Math.max(1, Math.ceil(unique.length / maxPages))
  const picked = unique.filter((_, i) => i % step === 0).slice(0, maxPages)
  if (!picked.includes(unique[0]!)) picked.unshift(unique[0]!)
  if (!picked.includes(unique[unique.length - 1]!)) {
    picked.push(unique[unique.length - 1]!)
  }
  const ordered = [...new Set(picked)].sort((a, b) => a - b)

  const splitMap = new Map(split.map((p) => [p.page, p.text]))
  return ordered
    .map((page) => {
      const src = byPage.get(page)
      const topics = (src?.topics ?? []).slice(0, 5).join(', ')
      const excerpt =
        cleanExcerpt(src?.excerpt || '') ||
        cleanExcerpt(splitMap.get(page) || '', 180)
      return `s.${page} | ${topics || '—'} | ${excerpt || '—'}`
    })
    .join('\n')
}
