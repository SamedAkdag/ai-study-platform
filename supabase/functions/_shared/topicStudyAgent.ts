/**
 * Agentic topic study — staged, not one mega-call:
 *   1) RESEARCH  — concepts, links, must-learn, misconceptions, seeds
 *   2) CLUSTER   — code packs concepts into time-budgeted units
 *   3) WRITE     — each unit SOURCE from its concept cluster only
 *
 * page_text = FIXED_SOURCE for Anlatım / Alıştır (same as PDF path).
 */

export type TeachPattern =
  | 'concept'
  | 'procedure'
  | 'compare'
  | 'system'
  | 'timeline'
  | 'applied'

export type TopicPurpose = 'exam' | 'understand' | 'homework' | 'review'

export type TopicBriefIn = {
  goal: string
  level: string
  depth: 'one' | 'path'
  minutes: number
  purpose: TopicPurpose
  subjectHint?: string
}

export type ConceptNode = {
  id: string
  name: string
  /** What it is — concrete, not slogan. */
  essence: string
  /** Why it matters for THIS goal. */
  why: string
  /** Other concept ids this depends on / connects to. */
  links_to: string[]
  /** 1 = first to learn. */
  learn_order: number
}

export type TopicResearch = {
  book_title: string
  subject: string | null
  pattern: TeachPattern
  pattern_reason: string
  audience_note: string
  /** One sentence: what mastery looks like for this brief. */
  core_claim: string
  prerequisites: string[]
  concepts: ConceptNode[]
  connections: { from: string; to: string; relation: string }[]
  misconceptions: string[]
  worked_seeds: string[]
  /** Ordered “öğrenilmesi gerekenler”. */
  must_learn: string[]
}

export type OutlineUnit = {
  title: string
  objective: string
  minutes: number
  summary: string
  key_concepts: string[]
  must_cover: string[]
  worked_hooks: string[]
  /** Concept ids owned by this unit. */
  concept_ids: string[]
}

export type TopicOutline = {
  book_title: string
  subject: string | null
  pattern: TeachPattern
  pattern_reason: string
  audience_note: string
  core_claim: string
  chapters: OutlineUnit[]
  research: TopicResearch
}

export type WrittenUnit = OutlineUnit & {
  page_text: string
}

const PATTERNS: TeachPattern[] = [
  'concept',
  'procedure',
  'compare',
  'system',
  'timeline',
  'applied',
]

const PURPOSES: TopicPurpose[] = [
  'exam',
  'understand',
  'homework',
  'review',
]

export function normalizeMinutes(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 30
  const allowed = [15, 30, 45, 60, 90]
  let best = 30
  let dist = Infinity
  for (const a of allowed) {
    const d = Math.abs(a - n)
    if (d < dist) {
      dist = d
      best = a
    }
  }
  return best
}

export function normalizePurpose(raw: unknown): TopicPurpose {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if ((PURPOSES as string[]).includes(s)) return s as TopicPurpose
  if (/sınav|yks|ayt|tyt|exam/.test(s)) return 'exam'
  if (/ödev|homework/.test(s)) return 'homework'
  if (/tekrar|review/.test(s)) return 'review'
  return 'understand'
}

export function normalizePattern(raw: unknown): TeachPattern {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if ((PATTERNS as string[]).includes(s)) return s as TeachPattern
  return 'concept'
}

export function sanitizeText(s: string, max = 24_000): string {
  return s.replace(/\u0000/g, '').trim().slice(0, max)
}

function asStringArray(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => sanitizeText(String(x), maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
}

/** Edge-safe unit/word budgets — path hard-caps at 3 units. */
export function planCapacity(brief: TopicBriefIn): {
  unitCount: { min: number; max: number }
  wordsPerUnit: { min: number; max: number }
  label: string
  /** Ideal concept count the researcher should aim for. */
  conceptTarget: { min: number; max: number }
} {
  const m = brief.minutes
  if (brief.depth === 'one') {
    if (m <= 15) {
      return {
        unitCount: { min: 1, max: 1 },
        wordsPerUnit: { min: 340, max: 520 },
        label: 'tek ünite · hızlı odak',
        conceptTarget: { min: 4, max: 7 },
      }
    }
    if (m <= 30) {
      return {
        unitCount: { min: 1, max: 1 },
        wordsPerUnit: { min: 480, max: 720 },
        label: 'tek ünite · orta yoğunluk',
        conceptTarget: { min: 5, max: 9 },
      }
    }
    return {
      unitCount: { min: 1, max: 1 },
      wordsPerUnit: { min: 560, max: 860 },
      label: 'tek ünite · derin geçiş',
      conceptTarget: { min: 6, max: 11 },
    }
  }

  if (m <= 30) {
    return {
      unitCount: { min: 2, max: 2 },
      wordsPerUnit: { min: 340, max: 500 },
      label: 'yol · 2 ünite',
      conceptTarget: { min: 6, max: 10 },
    }
  }
  if (m <= 60) {
    return {
      unitCount: { min: 3, max: 3 },
      wordsPerUnit: { min: 350, max: 500 },
      label: 'yol · 3 ünite',
      conceptTarget: { min: 8, max: 12 },
    }
  }
  return {
    unitCount: { min: 3, max: 3 },
    wordsPerUnit: { min: 380, max: 540 },
    label: 'geniş yol · 3 ünite (süre ünite içine)',
    conceptTarget: { min: 9, max: 14 },
  }
}

function patternBlueprint(pattern: TeachPattern): string {
  switch (pattern) {
    case 'procedure':
      return `KALIP procedure: hedef → önkoşul → adımlar (nedenli) → mini sayısal örnek → sık hata → kontrol`
    case 'compare':
      return `KALIP compare: eksenler → A/B → farklar → karar kuralı → karışan noktalar → senaryo`
    case 'system':
      return `KALIP system: sistem işi → parçalar → etkileşim → bozulma → örnek → şema`
    case 'timeline':
      return `KALIP timeline: önem → aşamalar → dönüm → sebep-sonuç → yanılgı → özet hikâye`
    case 'applied':
      return `KALIP applied: vaka → ilkeler → muhakeme → tuzak → genel kural → benzer mini vaka`
    case 'concept':
    default:
      return `KALIP concept: işleyen tanım → özellik/sınır → 1 benzetme → örnek → yanılgı → sınav ipucu → özet`
  }
}

function purposeLens(purpose: TopicPurpose): string {
  switch (purpose) {
    case 'exam':
      return `LENS sınav: ayırt edici fark, tipik soru, şık tuzağı.`
    case 'homework':
      return `LENS ödev: yapılabilir adımlar, kontrol sorusu.`
    case 'review':
      return `LENS tekrar: yoğun ayırt ediciler, flash-değerli noktalar.`
    case 'understand':
    default:
      return `LENS anlama: neden–nasıl bağları, yanılgıyı düzelt.`
  }
}

// ——— Stage 1: RESEARCH ———

export function researchSystemPrompt(): string {
  return `Sen Studium konu araştırma ajanısın. PDF yok. Görevin: hedef konuyu ÇALIŞILABİLİR kavram haritasına çevirmek.

Yap:
- Konuya özel kavramları çıkar (genel kültür / “önemlidir” yok)
- Her kavram: öz (essence) + bu hedef için neden (why) + bağlar
- Öğrenme sırası (learn_order)
- Bağlantı noktaları (connections)
- Sık yanılgılar
- Mini örnek tohumları (worked_seeds)
- must_learn: ölçülebilir “öğrenilmesi gerekenler” listesi
- Anlatım kalıbı öner (pattern)

Yazma / uzun anlatım YOK — sadece araştırma JSON.
Çıktı SADECE geçerli JSON.`
}

export function researchUserPrompt(
  brief: TopicBriefIn,
  capacity: ReturnType<typeof planCapacity>,
): string {
  return `Hedef: ${brief.goal}
Seviye: ${brief.level}
Amaç: ${brief.purpose}
Süre: ${brief.minutes} dk (${capacity.label})
Planlanan ünite sayısı: ${capacity.unitCount.min}–${capacity.unitCount.max}
Kavram hedefi: ${capacity.conceptTarget.min}–${capacity.conceptTarget.max} düğüm
${brief.subjectHint ? `Ders ipucu: ${brief.subjectHint}\n` : ''}
JSON şema:
{
  "book_title": "kısa başlık",
  "subject": "ders veya null",
  "pattern": "concept|procedure|compare|system|timeline|applied",
  "pattern_reason": "1 cümle",
  "audience_note": "seviyeye 1 cümle",
  "core_claim": "ustalık tek cümle",
  "prerequisites": ["…"],
  "concepts": [
    {
      "id": "c1",
      "name": "Kavram adı",
      "essence": "ne olduğu (1–2 cümle, somut)",
      "why": "bu hedef için neden",
      "links_to": ["c2"],
      "learn_order": 1
    }
  ],
  "connections": [
    {"from": "c1", "to": "c2", "relation": "önkoşul|karşıt|parça|sonuç|benzer"}
  ],
  "misconceptions": ["yanlış inanç → doğrusu kısa"],
  "worked_seeds": ["mini örnek tohumu"],
  "must_learn": ["ölçülebilir kazanım 1", "…"]
}`
}

export function normalizeResearch(
  raw: unknown,
  brief: TopicBriefIn,
  capacity: ReturnType<typeof planCapacity>,
): TopicResearch {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const bookTitle =
    sanitizeText(String(o.book_title || o.title || brief.goal), 120) ||
    brief.goal.slice(0, 80) ||
    'Konu çalışması'
  const subjectRaw = String(o.subject || brief.subjectHint || '').trim()
  const subject = subjectRaw ? sanitizeText(subjectRaw, 80) : null

  const conceptRaw = Array.isArray(o.concepts) ? o.concepts : []
  const concepts: ConceptNode[] = []
  for (let i = 0; i < conceptRaw.length; i += 1) {
    const item = conceptRaw[i]
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const name = sanitizeText(String(c.name || c.title || ''), 100)
    if (!name) continue
    const id =
      sanitizeText(String(c.id || `c${i + 1}`), 24).replace(/\s+/g, '_') ||
      `c${i + 1}`
    const orderRaw = Number(c.learn_order)
    concepts.push({
      id,
      name,
      essence:
        sanitizeText(String(c.essence || c.definition || ''), 320) ||
        `${name} — bu hedefteki yeri netleştir`,
      why:
        sanitizeText(String(c.why || c.relevance || ''), 240) ||
        `“${brief.goal}” için gerekli`,
      links_to: asStringArray(c.links_to, 6, 24),
      learn_order:
        Number.isFinite(orderRaw) && orderRaw > 0 ? Math.round(orderRaw) : i + 1,
    })
  }

  if (concepts.length === 0) {
    // Minimal seed so clustering never dies
    const g = brief.goal.slice(0, 80)
    concepts.push(
      {
        id: 'c1',
        name: g,
        essence: `${g} konusunun çekirdek tanımı ve kapsamı`,
        why: 'Hedefin ana omurgası',
        links_to: ['c2'],
        learn_order: 1,
      },
      {
        id: 'c2',
        name: 'Uygulama / örnek',
        essence: 'Konuyu somut örnekle işletme',
        why: 'Anlamayı ölçmek için',
        links_to: [],
        learn_order: 2,
      },
    )
  }

  concepts.sort((a, b) => a.learn_order - b.learn_order)
  const capped = concepts.slice(0, capacity.conceptTarget.max)

  const connectionsRaw = Array.isArray(o.connections) ? o.connections : []
  const connections: TopicResearch['connections'] = []
  for (const item of connectionsRaw) {
    if (!item || typeof item !== 'object') continue
    const x = item as Record<string, unknown>
    const from = sanitizeText(String(x.from || ''), 24)
    const to = sanitizeText(String(x.to || ''), 24)
    if (!from || !to) continue
    connections.push({
      from,
      to,
      relation: sanitizeText(String(x.relation || 'bağ'), 40) || 'bağ',
    })
  }
  // Derive links from concepts if empty
  if (connections.length === 0) {
    for (const c of capped) {
      for (const to of c.links_to) {
        connections.push({ from: c.id, to, relation: 'bağ' })
      }
    }
  }

  let mustLearn = asStringArray(o.must_learn, 10, 160)
  if (mustLearn.length === 0) {
    mustLearn = capped.slice(0, 6).map((c) => `${c.name}: ${c.essence.slice(0, 80)}`)
  }

  return {
    book_title: bookTitle,
    subject,
    pattern: normalizePattern(o.pattern),
    pattern_reason:
      sanitizeText(String(o.pattern_reason || ''), 240) ||
      'Konu yapısına uygun kalıp',
    audience_note:
      sanitizeText(String(o.audience_note || ''), 240) ||
      `${brief.level} seviyesine göre`,
    core_claim:
      sanitizeText(String(o.core_claim || ''), 280) ||
      `${brief.goal} konusunda temel yeterlilik`,
    prerequisites: asStringArray(o.prerequisites, 6, 120),
    concepts: capped,
    connections: connections.slice(0, 24),
    misconceptions: asStringArray(o.misconceptions, 6, 200),
    worked_seeds: asStringArray(o.worked_seeds, 6, 160),
    must_learn: mustLearn,
  }
}

// ——— Stage 2: CLUSTER (deterministic) ———

function chunkByCount<T>(items: T[], parts: number): T[][] {
  const n = Math.max(1, Math.min(parts, items.length))
  if (n === 1) return [items]
  const out: T[][] = Array.from({ length: n }, () => [])
  // Round-robin by learn order keeps progression across units
  items.forEach((item, i) => {
    const bucket = Math.min(n - 1, Math.floor((i * n) / items.length))
    out[bucket].push(item)
  })
  // Ensure no empty bucket
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].length === 0 && items.length) {
      out[i].push(items[Math.min(i, items.length - 1)])
    }
  }
  return out.filter((b) => b.length > 0)
}

export function clusterResearchIntoUnits(
  research: TopicResearch,
  brief: TopicBriefIn,
  capacity: ReturnType<typeof planCapacity>,
): TopicOutline {
  const unitN =
    brief.depth === 'one'
      ? 1
      : Math.min(
          capacity.unitCount.max,
          Math.max(capacity.unitCount.min, capacity.unitCount.max),
        )

  const buckets = chunkByCount(research.concepts, unitN)
  const minutesEach = Math.max(
    8,
    Math.round(brief.minutes / Math.max(1, buckets.length)),
  )

  const chapters: OutlineUnit[] = buckets.map((nodes, i) => {
    const names = nodes.map((n) => n.name)
    const title =
      buckets.length === 1
        ? research.book_title.slice(0, 100) || names[0] || 'Ünite'
        : i === 0
          ? `${names[0] || 'Temel'}: temel ve bağlar`
          : i === buckets.length - 1
            ? `${names[0] || 'Uygulama'}: pekiştirme`
            : `${names[0] || `Ünite ${i + 1}`}`

    const must_cover = [
      ...nodes.map((n) => `${n.name}: ${n.essence}`),
      ...research.connections
        .filter((c) => nodes.some((n) => n.id === c.from || n.id === c.to))
        .slice(0, 3)
        .map((c) => {
          const a = research.concepts.find((x) => x.id === c.from)?.name || c.from
          const b = research.concepts.find((x) => x.id === c.to)?.name || c.to
          return `Bağ: ${a} → ${b} (${c.relation})`
        }),
      ...research.misconceptions.slice(
        i * 1,
        i * 1 + (i === buckets.length - 1 ? 2 : 1),
      ),
    ].slice(0, 8)

    const mustSlice = research.must_learn.filter((_, idx) => {
      const part = Math.floor((idx * buckets.length) / Math.max(1, research.must_learn.length))
      return part === i || research.must_learn.length <= buckets.length
    })

    const objective =
      mustSlice[0] ||
      `Bu ünite bitince: ${names.slice(0, 2).join(' ve ') || title} ilişkisini açıklayabilir`

    const hooks = research.worked_seeds.length
      ? research.worked_seeds.slice(
          i,
          i + (i === buckets.length - 1 ? 2 : 1),
        )
      : [`${names[0] || title} için mini sayısal/somut örnek`]

    return {
      title: sanitizeText(title, 160),
      objective: sanitizeText(objective, 280),
      minutes: minutesEach,
      summary: sanitizeText(
        nodes.map((n) => n.name).join(' · ') || title,
        600,
      ),
      key_concepts: names.slice(0, 8),
      must_cover,
      worked_hooks: hooks,
      concept_ids: nodes.map((n) => n.id),
    }
  })

  return {
    book_title: research.book_title,
    subject: research.subject,
    pattern: research.pattern,
    pattern_reason: research.pattern_reason,
    audience_note: research.audience_note,
    core_claim: research.core_claim,
    chapters,
    research,
  }
}

// ——— Stage 3: WRITE ———

export function writeUnitSystemPrompt(
  pattern: TeachPattern,
  purpose: TopicPurpose,
): string {
  return `Sen Studium ünite yazarısın. Sadece bu üniteye ayrılan kavram kümesinden KAYNAK (SOURCE) üretirsin.

${patternBlueprint(pattern)}
${purposeLens(purpose)}

Kurallar:
- Araştırmadaki essence/why/bağları KULLAN; uydurma genel giriş yok.
- Türkçe, madde + kısa paragraf. ## başlık olabilir.
- Nicel konularda: varsayım listesi, formül düz metin, 1 mini sayısal adım.
- must_cover’ı karşıla; worked_hooks’tan en az bir örnek işlet.
- Çıktı SADECE JSON: {"page_text","title","summary","key_concepts"}
- page_text ana alanda (chapters dizisi değil); fence yok.`
}

export function writeUnitUserPrompt(input: {
  brief: TopicBriefIn
  outline: TopicOutline
  unit: OutlineUnit
  words: { min: number; max: number }
  unitIndex: number
  unitTotal: number
}): string {
  const { brief, outline, unit, words, unitIndex, unitTotal } = input
  const research = outline.research
  const nodes = research.concepts.filter((c) =>
    unit.concept_ids.includes(c.id),
  )
  const nodeBlock = nodes
    .map(
      (n) =>
        `- [${n.id}] ${n.name}\n  öz: ${n.essence}\n  neden: ${n.why}\n  bağlar: ${n.links_to.join(', ') || '—'}`,
    )
    .join('\n')

  const connBlock = research.connections
    .filter((c) => unit.concept_ids.includes(c.from) || unit.concept_ids.includes(c.to))
    .slice(0, 8)
    .map((c) => `- ${c.from} → ${c.to}: ${c.relation}`)
    .join('\n')

  return `Kitap: ${outline.book_title}
Hedef (tüm yol): ${brief.goal}
Ustalık iddiası: ${outline.core_claim}
Seviye: ${brief.level} · Amaç: ${brief.purpose} · Toplam süre: ${brief.minutes} dk
Kalıp: ${outline.pattern} (${outline.pattern_reason})
Kitle: ${outline.audience_note}
${research.prerequisites.length ? `Önkoşul notu: ${research.prerequisites.join('; ')}\n` : ''}
Ünite ${unitIndex}/${unitTotal} · ~${unit.minutes} dk
Başlık: ${unit.title}
Kazanım: ${unit.objective}

Bu üniteye ait kavramlar:
${nodeBlock || '(kavram listesi boş — başlıktan yaz)'}

Bağlantılar:
${connBlock || '—'}

must_cover:
${unit.must_cover.map((x, i) => `${i + 1}. ${x}`).join('\n')}

worked_hooks: ${unit.worked_hooks.join(' | ')}
Yanılgılar (ilgili): ${research.misconceptions.slice(0, 3).join(' || ') || '—'}

Kelime hedefi: ${words.min}–${words.max}

JSON: {"title","summary","key_concepts","page_text"}`
}

export function coerceWritePayload(raw: unknown): Record<string, unknown> {
  let o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (Array.isArray(o.chapters) && o.chapters[0] && typeof o.chapters[0] === 'object') {
    o = o.chapters[0] as Record<string, unknown>
  }
  const direct = sanitizeText(
    String(o.page_text || o.source || o.text || o.content || o.body || ''),
    20_000,
  )
  if (direct) return { ...o, page_text: direct }
  return o
}

export function buildOutlineSource(unit: OutlineUnit): string {
  return [
    `## ${unit.title}`,
    '',
    `Kazanım: ${unit.objective}`,
    '',
    '### Kapsanacak noktalar',
    ...unit.must_cover.map((m) => `- ${m}`),
    '',
    unit.key_concepts.length
      ? `### Anahtar kavramlar\n${unit.key_concepts.map((k) => `- ${k}`).join('\n')}`
      : '',
    '',
    unit.worked_hooks.length
      ? `### Örnek tohumları\n${unit.worked_hooks.map((h) => `- ${h}`).join('\n')}`
      : '',
    '',
    'Araştırma iskeleti — Anlatım’da Üret / soru ile genişlet.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function normalizeWrittenUnit(
  raw: unknown,
  fallback: OutlineUnit,
  opts?: { soft?: boolean; minChars?: number },
): WrittenUnit {
  const o = coerceWritePayload(raw)
  let page_text = sanitizeText(String(o.page_text || ''), 20_000)
  const minChars = opts?.minChars ?? 160

  if (page_text.length < minChars) {
    if (opts?.soft !== false) {
      const stub = buildOutlineSource(fallback)
      page_text = page_text.length >= 40 ? `${page_text}\n\n${stub}` : stub
    } else {
      throw new Error(`Ünite kaynağı çok kısa: ${fallback.title}`)
    }
  }

  return {
    ...fallback,
    title: sanitizeText(String(o.title || fallback.title), 160) || fallback.title,
    summary:
      sanitizeText(String(o.summary || fallback.summary), 600) ||
      fallback.summary,
    key_concepts: (() => {
      const k = asStringArray(o.key_concepts, 8, 80)
      return k.length ? k : fallback.key_concepts
    })(),
    page_text,
  }
}

export function qualityIssues(
  unit: WrittenUnit,
  brief: TopicBriefIn,
  words: { min: number; max: number },
): string[] {
  const issues: string[] = []
  const text = unit.page_text
  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount < Math.floor(words.min * 0.65)) {
    issues.push(`çok kısa (~${wordCount} kelime; hedef ≥${words.min})`)
  }

  const goalTokens = brief.goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .slice(0, 8)
  const lower = text.toLowerCase()
  const hit = goalTokens.filter((t) => lower.includes(t)).length
  if (goalTokens.length >= 2 && hit < Math.min(2, goalTokens.length)) {
    issues.push('hedefteki anahtar kelimeler metinde zayıf')
  }

  if (
    /bu konu önemlidir|hayatımızda sıkça|öğrenmek faydalıdır/i.test(
      text.slice(0, 400),
    )
  ) {
    issues.push('genel giriş gevezeliği')
  }

  return issues
}

export function repairUnitUserPrompt(input: {
  brief: TopicBriefIn
  outline: TopicOutline
  unit: WrittenUnit
  issues: string[]
  words: { min: number; max: number }
}): string {
  const nodes = input.outline.research.concepts.filter((c) =>
    input.unit.concept_ids.includes(c.id),
  )
  return `SOURCE kalite kapısından geçmedi: ${input.issues.join('; ')}

Hedef: ${input.brief.goal}
Ünite: ${input.unit.title}
Kavramlar: ${nodes.map((n) => n.name).join(', ')}
must_cover: ${input.unit.must_cover.join(' | ')}
Kelime: ${input.words.min}–${input.words.max}

Önceki (kısaltılmış):
${input.unit.page_text.slice(0, 2800)}

Yeniden yaz — kavram özlerini işle, kısa kesme.
JSON: {"title","summary","key_concepts","page_text"}`
}

/** Multi-unit write in ONE call — keeps research→cluster→write, avoids RPM burn. */
export function writeBatchSystemPrompt(
  pattern: TeachPattern,
  purpose: TopicPurpose,
): string {
  return `${writeUnitSystemPrompt(pattern, purpose)}

TOPLU YAZIM: Tüm üniteleri TEK JSON’da döndür.
Her ünite yalnız kendi kavram kümesini işlesin; tekrar etme, ileri ünite öncekinin üzerine kursun.
{"chapters":[{"title","summary","key_concepts","page_text"}]}`
}

export function writeBatchUserPrompt(input: {
  brief: TopicBriefIn
  outline: TopicOutline
  words: { min: number; max: number }
}): string {
  const { brief, outline, words } = input
  const research = outline.research
  const blocks = outline.chapters
    .map((unit, i) => {
      const nodes = research.concepts.filter((c) =>
        unit.concept_ids.includes(c.id),
      )
      const nodeLines = nodes
        .map((n) => `  • ${n.name}: ${n.essence} (neden: ${n.why})`)
        .join('\n')
      return `### Ünite ${i + 1}/${outline.chapters.length} — ${unit.title}
Kazanım: ${unit.objective}
Süre: ~${unit.minutes} dk
Kavramlar:
${nodeLines || '  • (başlıktan yaz)'}
must_cover: ${unit.must_cover.join(' | ')}
hooks: ${unit.worked_hooks.join(' | ')}`
    })
    .join('\n\n')

  return `Kitap: ${outline.book_title}
Hedef: ${brief.goal}
Ustalık: ${outline.core_claim}
Seviye: ${brief.level} · Amaç: ${brief.purpose} · ${brief.minutes} dk
Kalıp: ${outline.pattern} (${outline.pattern_reason})
Yanılgılar: ${research.misconceptions.slice(0, 4).join(' || ') || '—'}
must_learn: ${research.must_learn.slice(0, 6).join(' · ')}

Her page_text ${words.min}–${words.max} kelime. ${outline.chapters.length} üniteyi tek yanıtta yaz.

${blocks}

JSON: {"chapters":[{"title","summary","key_concepts","page_text"}]}`
}

export function normalizeBatchWritten(
  raw: unknown,
  outline: TopicOutline,
): WrittenUnit[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const list = Array.isArray(o.chapters) ? o.chapters : []
  return outline.chapters.map((fallback, i) => {
    const item = list[i]
    return normalizeWrittenUnit(
      item && typeof item === 'object' ? item : {},
      fallback,
      { soft: true },
    )
  })
}

/** Compact research blurb stored atop unit 1 for the study desk. */
export function researchHeader(research: TopicResearch): string {
  return [
    '--- Topic research ---',
    `core: ${research.core_claim}`,
    `pattern: ${research.pattern} — ${research.pattern_reason}`,
    `must_learn: ${research.must_learn.slice(0, 6).join(' · ')}`,
    `concepts: ${research.concepts.map((c) => c.name).join(' · ')}`,
    '',
  ].join('\n')
}
