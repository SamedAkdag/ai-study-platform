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

/**
 * Empty structural shells: "Birinci bölüm", "Bölüm 2", "Ana başlık 3", …
 */
export function isGenericSectionLabel(raw: string): boolean {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return true
  if (
    /^(birinci|ikinci|üçüncü|ucuncu|dördüncü|dorduncu|beşinci|besinci|altıncı|altinci|yedinci|sekizinci|dokuzuncu|onuncu)\s+(bölüm|bolum|kısım|kisim|ünite|unite|section|chapter|part)\b/i.test(
      s,
    )
  ) {
    return true
  }
  if (
    /^(bölüm|bolum|kısım|kisim|ünite|unite|section|chapter|part|unit)\s*[:.\-]?\s*\d+[a-z]?\s*$/i.test(
      s,
    )
  ) {
    return true
  }
  if (
    /^\d+\s*[.)]?\s*(bölüm|bolum|kısım|kisim|section|chapter|part|ünite|unite)\s*$/i.test(
      s,
    )
  ) {
    return true
  }
  if (/^(ana\s+başlık|alt\s+başlık|başlık|konu)\s*\d*$/i.test(s)) return true
  if (
    /^(özet|ozet|giriş|giris|sonuç|sonuc|genel\s+bakış|genel\s+bakis|içindekiler|icindekiler)$/i.test(
      s,
    )
  ) {
    return true
  }
  return false
}

/** Title text after stripping leading section numbers / "Bölüm N:". */
export function topicTitleCore(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^((\d+\.)+\d*)\s+/, '')
    .replace(
      /^(bölüm|bolum|chapter|section|unit|kısım|kisim|ünite|unite)\s*\d*\s*[:.\-]?\s*/i,
      '',
    )
    .trim()
}

/** Predicate / clause cues — mind-map nodes must NOT be sentence scraps. */
const SENTENCE_LIKE_RE =
  /\b(dır|dir|tır|tir|dur|dür|tur|tür|edir|adır|abilir|ebilir|mektedir|maktadır|olur|eder|yapar|sağlar|saglar|içerir|icerir|anlamına|anlamina|gösterir|gosterir|belirler|ifade\s+eder|söz\s+konusu|şeklinde|seklinde|olarak\s+adlandır|olarak\s+adlandir|denir|edilir|yapılır|yapilir|alınır|alinir|hesaplanır|hesaplanir|yaklaşır|yaklasir|yaklaşırken|yaklasirken|giderken|gelirken|bulunur|verilir|yazılır|yazilir|tanımlanır|tanimlanir|anlaşılır|anlasilir)\b/i

const HANGING_END_RE =
  /\b(ve|veya|ile|için|icin|olan|olarak|gibi|kadar|de|da|ki|bu|şu|su|bir|the|of|to|for|that|which|iken)$/i

const WEAK_START_RE =
  /^(bu|şu|su|bir|the|a|an|tanım|tanim|yani|örneğin|ornegin|şekilde|sekilde|şöyle|soyle|neden|nasıl|nasil|eğer|eger|ise)\b/i

/** Adverbial participle scrap: "yaklaşırken", "giderken" (not short roots like "etken") */
const PARTICIPLE_SCRAP_RE =
  /\w{4,}(ırken|irken|arken|erken|urken|ürken)\b/i

/**
 * True for half-sentences / definition scraps unfit as TOC node titles.
 * Good: "Limit Tanımı". Bad: "Limit bir noktaya yaklaşırken", "olan fonksiyon".
 */
export function isSentenceFragmentLabel(raw: string): boolean {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return true
  if (SENTENCE_LIKE_RE.test(s)) return true
  if (HANGING_END_RE.test(s)) return true
  if (PARTICIPLE_SCRAP_RE.test(s)) return true
  if (/…|\.{2,}$/.test(s) || /,$/.test(s)) return true
  const words = s.split(/\s+/).filter(Boolean)
  if (WEAK_START_RE.test(s) && words.length >= 3) return true
  // Relative-clause dumps used as titles
  if (
    /\b(olan|olduğu|oldugu|edilen|yapılan|yapilan|gösterilen|gosterilen|alınan|alinan|bulunan|verilen|yazılan|yazilan)\b/i.test(
      s,
    ) &&
    words.length >= 3
  ) {
    return true
  }
  // Definition scrap: "Limit bir noktaya …" (noun + bir + dative noun)
  if (/\b\w{3,}\s+bir\s+\w{3,}(ya|ye|a|e)\b/i.test(s) && words.length >= 3) {
    return true
  }
  // Too long for a node title → almost always a clipped sentence
  if (words.length > 6) return true
  return false
}

/**
 * Reject numbers-only, ordinal shells, OCR scraps, mid-word cuts,
 * and half-sentence / definition fragments.
 */
export function isWeakTopicLabel(raw: string): boolean {
  if (isGenericSectionLabel(raw)) return true
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s.length < 4) return true
  if (/^[\d.\-–—)\]]+$/.test(s)) return true
  if (/^\d+(\.\d+){0,5}\.?$/.test(s)) return true
  if (/^[\d.\s\-–—]+$/.test(s)) return true
  if (isSentenceFragmentLabel(s)) return true

  const core = topicTitleCore(s)
  if (!core || core.length < 4) return true
  if (isSentenceFragmentLabel(core)) return true

  const letters = core.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')
  if (letters.length < 6) return true

  const words = core.split(/\s+/).filter(Boolean)
  const contentWords = words.filter(
    (w) => !/^\d+([.\-]\d+)*\.?$/.test(w) && /[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/i.test(w),
  )
  if (contentWords.length < 1) return true

  if (/[-–—]$/.test(s) || /[-–—]$/.test(core)) return true
  const last = contentWords[contentWords.length - 1] || ''
  // Half-word leftovers from char caps (e.g. "Sürekl")
  if (
    last.length >= 5 &&
    last.length <= 10 &&
    !/(lar|ler|lık|lik|luk|lük|mak|mek|ası|esi|ması|mesi|nin|nın|nun|nün|den|dan|ile)$/i.test(
      last,
    ) &&
    !/[aeıioöuüAEIİOÖUÜ]$/.test(last) &&
    letters.length < 18
  ) {
    return true
  }
  return false
}

/**
 * Mind-map node title: complete noun-phrase only.
 * Never chop a definition/sentence into a hanging fragment — reject instead.
 */
export function toMindMapNodeLabel(raw: string): string {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''

  s = s.replace(
    /^(tanım|tanim|kavram|başlık|baslik|konu|özet|ozet|madde)\s*[:：\-–]\s*/i,
    '',
  )
  const quoted = s.match(/^["“«]([^"”»]{2,48})["”»]/)
  if (quoted?.[1]) s = quoted[1].trim()

  s = s.split(/[.!?;]/)[0] || s
  s = s.replace(/\s*\([^)]{0,80}\)\s*$/g, '').trim()
  s = s.replace(/^[\s\-–—:·]+|[\s\-–—:·,]+$/g, '').trim()

  // Already a clean short title
  const words = s.split(/\s+/).filter(Boolean)
  if (
    words.length >= 1 &&
    words.length <= 6 &&
    s.length <= 52 &&
    !isWeakTopicLabel(s)
  ) {
    return s
  }

  // Try phrase before first predicate — only keep if result is a full NP title
  const beforePred = s
    .split(
      /\s+(?:dır|dir|tır|tir|olan|için|icin|çünkü|cunku|ise|ki|ve\s+bu|veya|bir\s+)\s*/i,
    )[0]
    ?.trim()
  if (
    beforePred &&
    beforePred !== s &&
    beforePred.split(/\s+/).length >= 1 &&
    beforePred.split(/\s+/).length <= 5 &&
    beforePred.length >= 4 &&
    !isWeakTopicLabel(beforePred)
  ) {
    return beforePred
  }

  // Do NOT return half-sentences / chopped definitions
  return ''
}

/** Compress text to a short heading; mind-map callers should prefer toMindMapNodeLabel. */
export function toTopicLabel(
  raw: string,
  maxWords = 5,
  maxChars = 48,
): string {
  // Mind-map style: refuse sentence scraps instead of truncating them
  const node = toMindMapNodeLabel(raw)
  if (node) {
    const words = node.split(/\s+/).filter(Boolean)
    if (words.length <= maxWords && node.length <= maxChars) return node
    // Soft trim only on already-clean noun phrases, at word boundary
    if (words.length > maxWords) {
      const clipped = words.slice(0, maxWords).join(' ')
      return isWeakTopicLabel(clipped) ? '' : clipped
    }
    if (node.length > maxChars) {
      const cut = node.slice(0, maxChars)
      const sp = cut.lastIndexOf(' ')
      if (sp > 8) {
        const clipped = cut.slice(0, sp).trim()
        return isWeakTopicLabel(clipped) ? '' : clipped
      }
      return ''
    }
    return node
  }
  return ''
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
      let label = toMindMapNodeLabel(String(row.label || ''))
      if (!label) continue
      // Promote a real child topic over shell / scrap labels
      if (isWeakTopicLabel(label) && Array.isArray(row.children)) {
        const promoted = row.children
          .map((c) => toMindMapNodeLabel(String(c || '')))
          .find((c) => c && !isWeakTopicLabel(c))
        if (promoted) label = promoted
        else continue
      }
      if (isWeakTopicLabel(label)) continue
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
          const topic = toMindMapNodeLabel(cl)
          const ck = topic.toLowerCase()
          if (!topic || ck === key || childSeen.has(ck)) continue
          if (isWeakTopicLabel(topic)) continue
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
  /^(özet|ozet|sınav kartı|sinav kartı|sık yapılan|anahtar noktalar|neden önemli|günlük hayattan|adım adım|bölüm\s*\d+|detay\s*\d+|birinci\s+bölüm|ikinci\s+bölüm|üçüncü\s+bölüm|ucuncu\s+bolum)/i

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
  if (s.length < 6 || s.length > 90) return false
  if (/https?:\/\//i.test(s)) return false
  if (/^\d+$/.test(s) || /^[\d.\-–—]+$/.test(s)) return false
  if (/^[•·\-–—*]\s/.test(s)) return false
  if (isWeakTopicLabel(s)) return false
  // Skip obvious body sentences
  if (/\b(çünkü|ancak|fakat|şöyle ki|olarak kabul|görülür|edilir)\b/i.test(s)) {
    return false
  }
  if (/[.!?]{2,}/.test(s)) return false
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 14) return false

  const letters = s.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')
  if (letters.length < 6) return false

  // Numbered textbook headings: 3.1 Title — require real title text
  if (/^(\d+\.)+\d*\s+\S/.test(s)) {
    return topicTitleCore(s).replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length >= 6
  }
  // "Bölüm 3: Limitler" OK — bare "Bölüm 1" rejected by isWeakTopicLabel
  if (
    /^(bölüm|bolum|chapter|unit|section|kısım|kisim)\b/i.test(s) &&
    !isWeakTopicLabel(s)
  ) {
    return true
  }
  // Short line without sentence end → likely heading
  if (!/[.!?]$/.test(s) && words.length <= 10 && letters.length >= 8) return true
  // ALL-CAPS short headings
  if (
    letters.length >= 6 &&
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
  const s = cleanHeading(line).replace(/\s+/g, ' ').trim()
  const labeled = toTopicLabel(s, 8, 56)
  if (!labeled || isWeakTopicLabel(labeled)) return ''
  return labeled
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
      if (!label || SKIP_HEADING.test(label) || isWeakTopicLabel(label)) {
        continue
      }
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
    if (isWeakTopicLabel(label)) return
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
    if (isWeakTopicLabel(label)) return
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
      .map((t) => toTopicLabel(String(t), 7, 52))
      .filter((t): t is string => !!t && !isWeakTopicLabel(t))
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
      const label = toTopicLabel(raw, 7, 52)
      if (!label || SKIP_HEADING.test(label) || isWeakTopicLabel(label)) {
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
      const label = toTopicLabel(cleanHeading(h3[1] || ''), 6, 48)
      if (
        !label ||
        SKIP_HEADING.test(label) ||
        isWeakTopicLabel(label) ||
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
      .map((t) => toTopicLabel(String(t), 6, 48))
      .filter((t): t is string => !!t && !isWeakTopicLabel(t))
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
        .map((t) => toTopicLabel(String(t), 6, 48))
        .filter((t): t is string => !!t && !isWeakTopicLabel(t))
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
    let weak = 0
    for (const b of m.branches) {
      if (isWeakTopicLabel(b.label)) {
        weak += 1
        s -= 14
      } else {
        s += 2
      }
      const kids = b.children ?? []
      if (kids.length >= 2) filled += 1
      s += Math.min(kids.length, 6) * 2
      for (const c of kids) {
        if (isWeakTopicLabel(c)) {
          weak += 1
          s -= 5
        }
        if (c.length > 56) s -= 3
        if (/\b(dır|dir|çünkü|olan|için)\b/i.test(c)) s -= 3
        if (c.split(/\s+/).length <= 7) s += 1
      }
    }
    s += filled * 4
    if (weak >= Math.max(2, Math.ceil(m.branches.length * 0.3))) s -= 50
    return s
  }

  const llmWeak = llm.branches.filter((b) => isWeakTopicLabel(b.label)).length
  // Numbers / half-names / ordinal shells → keep deterministic outline
  if (llmWeak >= Math.max(1, Math.ceil(llm.branches.length * 0.25))) {
    return outline
  }

  const outlineGood = outline.branches.filter(
    (b) => !isWeakTopicLabel(b.label),
  ).length
  const llmFilled = llm.branches.filter(
    (b) => (b.children?.length ?? 0) >= 2 && !isWeakTopicLabel(b.label),
  ).length

  // Prefer a solid notes/PDF outline over a flashy but messy LLM tree
  if (outlineGood >= 4 && llmFilled < 4) return outline

  if (llm.branches.length >= 6 && llmFilled >= 4) return llm
  if (llm.branches.length > outline.branches.length + 1 && llmFilled >= 3) {
    return llm
  }

  return score(llm) >= score(outline) ? llm : outline
}

/** Count how many branch labels look like scraps / numbers / shells. */
export function weakMindMapLabelRatio(map: MindMap | null): number {
  if (!map?.branches?.length) return 1
  const weak = map.branches.filter((b) => isWeakTopicLabel(b.label)).length
  return weak / map.branches.length
}

function goodBranchCount(map: MindMap | null): number {
  if (!map?.branches?.length) return 0
  return map.branches.filter((b) => !isWeakTopicLabel(b.label)).length
}

/**
 * Prefer PDF / notes TOC over LLM when Ling invents numbers & half-names.
 * Call LLM only if deterministic sources are thin; discard weak LLM trees.
 */
export function assembleMindMap(input: {
  title: string
  pdfMap: MindMap | null
  notesOutline: MindMap | null
  llmMap: MindMap | null
  concepts?: string[]
}): MindMap {
  const { title, pdfMap, notesOutline, llmMap, concepts = [] } = input
  const det = pickBetterMindMap(pdfMap, notesOutline)
  const detGood = goodBranchCount(det)
  const llmGood = goodBranchCount(llmMap)
  const llmWeak = weakMindMapLabelRatio(llmMap)

  let chosen: MindMap | null = null
  if (detGood >= 4 && (llmWeak > 0.2 || llmGood < detGood)) {
    chosen = det
  } else if (llmMap && llmWeak <= 0.2 && llmGood >= 3) {
    chosen = pickBetterMindMap(det, llmMap) || llmMap || det
  } else {
    chosen = det || (llmWeak <= 0.35 ? llmMap : null)
  }

  if (!chosen || goodBranchCount(chosen) < 2) {
    chosen = mindMapFallback(title, concepts)
  }
  return chosen
}

/** Aşama 1 shape: real topic hubs, empty children. */
export function toSkeletonMindMap(map: MindMap, maxBranches = 9): MindMap {
  const branches = map.branches
    .map((b) => {
      const label = toMindMapNodeLabel(b.label)
      if (!label || isWeakTopicLabel(label)) return null
      return {
        label,
        children: [] as string[],
        ...(typeof b.page === 'number' && b.page >= 1 ? { page: b.page } : {}),
      }
    })
    .filter((b): b is NonNullable<typeof b> => !!b)
    .slice(0, maxBranches)
  return {
    central:
      toMindMapNodeLabel(map.central) ||
      toTopicLabel(map.central, 5, 40) ||
      map.central,
    branches,
  }
}

/** Compact skeleton for LLM fill prompt (labels + pages only). */
export function skeletonForFillPrompt(map: MindMap): string {
  const skel = toSkeletonMindMap(map)
  return JSON.stringify({
    central: skel.central,
    branches: skel.branches.map((b) => ({
      label: b.label,
      page: b.page ?? null,
      children: [],
    })),
  })
}

/**
 * Merge Aşama2 fill onto Aşama1 skeleton: keep skeleton labels/pages,
 * take filtered children from fill (or keep prior kids if fill empty).
 */
export function mergeMindMapFill(
  skeleton: MindMap,
  filled: MindMap | null,
): MindMap {
  if (!filled?.branches?.length) return skeleton
  const byKey = new Map<string, MindMap['branches'][number]>()
  for (const b of filled.branches) {
    byKey.set(b.label.toLowerCase(), b)
  }
  const used = new Set<string>()
  const branches = skeleton.branches.map((b) => {
    const key = b.label.toLowerCase()
    let hit = byKey.get(key)
    if (!hit && typeof b.page === 'number') {
      hit = filled.branches.find((f) => f.page === b.page)
    }
    if (hit) used.add(hit.label.toLowerCase())
    const fromFill = (hit?.children ?? [])
      .map((c) => toMindMapNodeLabel(c))
      .filter(
        (c): c is string =>
          !!c &&
          !isWeakTopicLabel(c) &&
          c.toLowerCase() !== key,
      )
      .slice(0, 7)
    const prior = (b.children ?? [])
      .map((c) => toMindMapNodeLabel(c))
      .filter(
        (c): c is string =>
          !!c && !isWeakTopicLabel(c) && c.toLowerCase() !== key,
      )
    const children = (fromFill.length >= 2 ? fromFill : prior.length ? prior : fromFill)
      .slice(0, 7)
    return {
      ...b,
      children,
      ...(hit?.narration && !b.narration ? { narration: hit.narration } : {}),
    }
  })
  // Append strong fill-only branches if skeleton was thin
  if (branches.length < 5) {
    for (const f of filled.branches) {
      const k = f.label.toLowerCase()
      if (used.has(k) || isWeakTopicLabel(f.label)) continue
      const fl = toMindMapNodeLabel(f.label)
      if (!fl) continue
      branches.push({
        label: fl,
        page: f.page,
        children: (f.children ?? [])
          .map((c) => toMindMapNodeLabel(c))
          .filter((c): c is string => !!c && !isWeakTopicLabel(c))
          .slice(0, 7),
      })
      if (branches.length >= 9) break
    }
  }
  return {
    central: skeleton.central || filled.central,
    ...(skeleton.narration || filled.narration
      ? { narration: skeleton.narration || filled.narration }
      : {}),
    branches: branches.filter((b) => b.label && !isWeakTopicLabel(b.label)),
  }
}

export type MindMapAskJson = (
  task: string,
) => Promise<Record<string, unknown>>

export type TwoStageMindMapMeta = {
  stage1: 'pdf_notes' | 'llm_skel' | 'fallback'
  stage2: 'llm_fill' | 'deterministic' | 'skipped'
  usedLlmSkel: boolean
  usedLlmFill: boolean
  skeletonBranches: number
  finalBranches: number
}

/**
 * Two-stage mind map (product port of the detailed PDF→mindmap contract):
 * 1) Skeleton from PDF TOC + notes (LLM skel only if thin)
 * 2) Fill children via LLM on locked skeleton labels, else deterministic kids
 */
export async function buildTwoStageMindMap(opts: {
  title: string
  pageText: string
  pageSources: PageSource[]
  notesMarkdown: string
  concepts?: string[]
  askJson: MindMapAskJson
}): Promise<{ map: MindMap; meta: TwoStageMindMapMeta }> {
  const title = opts.title
  const concepts = opts.concepts ?? []
  const pdfMap = buildMindMapFromPdf(title, opts.pageText, opts.pageSources)
  const notesOutline = buildOutlineMindMap(
    title,
    opts.notesMarkdown,
    opts.pageSources,
  )
  const det = pickBetterMindMap(pdfMap, notesOutline)
  const detGood = goodBranchCount(det)

  let skeleton: MindMap | null =
    det && detGood >= 3 ? toSkeletonMindMap(det) : null
  let stage1: TwoStageMindMapMeta['stage1'] = skeleton
    ? 'pdf_notes'
    : 'fallback'
  let usedLlmSkel = false

  if (!skeleton || goodBranchCount(skeleton) < 5) {
    try {
      const raw = await opts.askJson(taskMindMapSkeletonTask())
      const llmSkel = parseMindMap(raw.mind_map ?? raw, title)
      if (llmSkel && weakMindMapLabelRatio(llmSkel) <= 0.25) {
        const cleaned = toSkeletonMindMap(llmSkel)
        if (goodBranchCount(cleaned) >= goodBranchCount(skeleton)) {
          skeleton = cleaned
          stage1 = 'llm_skel'
          usedLlmSkel = true
        }
      }
    } catch {
      /* keep deterministic */
    }
  }

  if (!skeleton || goodBranchCount(skeleton) < 2) {
    skeleton = toSkeletonMindMap(
      mindMapFallback(title, concepts),
    )
    stage1 = 'fallback'
  }

  // Prefer richer children already on deterministic tree as fill baseline
  const detWithKids =
    det && goodBranchCount(det) >= 2
      ? mergeMindMapFill(skeleton, det)
      : skeleton

  let stage2: TwoStageMindMapMeta['stage2'] = 'deterministic'
  let usedLlmFill = false
  let filled: MindMap | null = null
  // Aşama 2 always attempted when skeleton is usable
  if (goodBranchCount(skeleton) >= 3) {
    try {
      const raw = await opts.askJson(
        taskMindMapFillTask(skeletonForFillPrompt(skeleton)),
      )
      filled = parseMindMap(raw.mind_map ?? raw, title)
      if (filled && weakMindMapLabelRatio(filled) <= 0.3) {
        usedLlmFill = true
        stage2 = 'llm_fill'
      } else {
        filled = null
      }
    } catch {
      filled = null
    }
  } else {
    stage2 = 'skipped'
  }

  let map = mergeMindMapFill(detWithKids, filled)
  if (weakMindMapLabelRatio(map) > 0.25 && det) {
    map = mergeMindMapFill(toSkeletonMindMap(det), det)
    stage2 = 'deterministic'
    usedLlmFill = false
  }
  if (goodBranchCount(map) < 2) {
    map = mindMapFallback(title, concepts)
  }

  return {
    map,
    meta: {
      stage1,
      stage2,
      usedLlmSkel,
      usedLlmFill,
      skeletonBranches: skeleton.branches.length,
      finalBranches: map.branches.length,
    },
  }
}

/** Local task strings — avoid circular import with cacheableChapter. */
function taskMindMapSkeletonTask(): string {
  return `MINDMAP_SKEL | Aşama1 | 5–9 ana | children=[] | label=TAM isim öbeği ≤6 kelime | İyi:"Limit Tanımı" Kötü:"Limit bir noktaya" | yarım cümle/tanım cümlesi YASAK | şema MINDMAP_SKEL`
}

function taskMindMapFillTask(skeletonJson: string): string {
  const skel = skeletonJson.replace(/\s+/g, ' ').trim().slice(0, 1400)
  return `MINDMAP_FILL | Aşama2 | label/page KORU | altlar=kısa isim öbeği (tanım/yarım cümle YASAK) | iskelet:${skel}`
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
