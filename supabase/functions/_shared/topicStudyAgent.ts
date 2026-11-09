/**
 * Agentic topic study — LangChain-style staged orchestration (no mega-prompt):
 *
 *   1) CHARTER   — learning contract (what ChatGPT user would refine in 3–4 prompts)
 *   2) RESEARCH  — concept graph, links, misconceptions, seeds
 *   3) CURRICULUM— timed session architect (beats, checkpoints, teacher prompts)
 *   4) WRITE     — SOURCE per unit from the prepared brief (not from thin air)
 *
 * Depth scales with minutes × purpose × depth. page_text = FIXED_SOURCE for Anlatım.
 */

export type TeachPattern =
  | 'concept'
  | 'procedure'
  | 'compare'
  | 'system'
  | 'timeline'
  | 'applied'

export type TopicPurpose = 'exam' | 'understand' | 'homework' | 'review'

/** User answers that lock teaching angle / scope before generation. */
export type TopicLock = {
  id: string
  question: string
  answer: string
  optionId: string
}

export type TopicClarifyQuestion = {
  id: string
  prompt: string
  why: string
  options: Array<{ id: string; label: string }>
}

export type TopicBriefIn = {
  goal: string
  level: string
  depth: 'one' | 'path'
  minutes: number
  purpose: TopicPurpose
  subjectHint?: string
  /** Dynamic lock answers from clarify step. */
  locks?: TopicLock[]
}

export function normalizeLocks(raw: unknown): TopicLock[] {
  if (!Array.isArray(raw)) return []
  const out: TopicLock[] = []
  for (let i = 0; i < raw.length && out.length < 6; i += 1) {
    const row = raw[i]
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const question = sanitizeText(String(r.question || r.prompt || ''), 220)
    const answer = sanitizeText(String(r.answer || r.label || ''), 160)
    if (!question || !answer) continue
    out.push({
      id:
        sanitizeText(String(r.id || `lock${i + 1}`), 32).replace(/\s+/g, '_') ||
        `lock${i + 1}`,
      question,
      answer,
      optionId: sanitizeText(String(r.optionId || r.option_id || ''), 40),
    })
  }
  return out
}

/** Hard rule: user's stated topic is the center, not a tour of neighbors. */
export function centerFocusRules(goal: string): string {
  const g = sanitizeText(goal, 200) || 'verilen konu'
  return `MERKEZ KURALI (ZORUNLU):
- Kullanıcının verdiği konu TEK MERKEZDİR: «${g}»
- Anlatım bu konunun kendisine odaklanır. Yan / bağlantılı / önkoşul konular ana omurga OLAMAZ.
- Bağlantılar yalnızca merkezi anlamak için en fazla 1–2 cümle köprü olabilir; ayrı ünite veya ana bölüm yapma.
- book_title, core_claim, must_learn ve concepts[0] merkeze bağlansın.
- concepts içindeki diğer öğeler merkezin ALT BİLEŞENLERİ olsun (komşu ders konuları değil).`
}

export function locksBlock(brief: TopicBriefIn): string {
  if (!brief.locks?.length) return ''
  return `KİLİT CEVAPLAR (süreci bunlara göre kilitle — sapma YASAK):
${brief.locks.map((l) => `- ${l.question} → ${l.answer}`).join('\n')}
`
}

export type LearningCharter = {
  refined_goal: string
  success_criteria: string[]
  audience_constraints: string
  out_of_scope: string[]
  hooks: string[]
  assumptions: string[]
  teaching_stance: string
}

export type ConceptNode = {
  id: string
  name: string
  essence: string
  why: string
  links_to: string[]
  learn_order: number
}

export type TopicResearch = {
  book_title: string
  subject: string | null
  pattern: TeachPattern
  pattern_reason: string
  audience_note: string
  core_claim: string
  prerequisites: string[]
  concepts: ConceptNode[]
  connections: { from: string; to: string; relation: string }[]
  misconceptions: string[]
  worked_seeds: string[]
  must_learn: string[]
}

export type TimedBeat = { minutes: number; focus: string }

export type OutlineUnit = {
  title: string
  objective: string
  minutes: number
  summary: string
  key_concepts: string[]
  must_cover: string[]
  worked_hooks: string[]
  concept_ids: string[]
  /** Session choreography — replaces “user writes 5 prompts”. */
  timed_beats: TimedBeat[]
  deep_dives: string[]
  teacher_prompts: string[]
  checkpoint: string
  practice_prompt: string
  worked_example: string
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
  charter: LearningCharter | null
}

export type WrittenUnit = OutlineUnit & {
  page_text: string
}

export type PipelineMode = 'lite' | 'standard' | 'deep'

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

/**
 * Budgets + which agent stages to run.
 * deep (90 / long path) = charter + research + LLM curriculum + rich write
 */
export function planCapacity(brief: TopicBriefIn): {
  unitCount: { min: number; max: number }
  wordsPerUnit: { min: number; max: number }
  label: string
  conceptTarget: { min: number; max: number }
  mode: PipelineMode
  useCharter: boolean
  useCurriculumLlm: boolean
} {
  const m = brief.minutes
  if (brief.depth === 'one') {
    if (m <= 15) {
      return {
        unitCount: { min: 1, max: 1 },
        wordsPerUnit: { min: 360, max: 560 },
        label: 'tek ünite · sprint',
        conceptTarget: { min: 4, max: 7 },
        mode: 'lite',
        useCharter: false,
        useCurriculumLlm: false,
      }
    }
    if (m <= 30) {
      return {
        unitCount: { min: 1, max: 1 },
        wordsPerUnit: { min: 520, max: 780 },
        label: 'tek ünite · standart',
        conceptTarget: { min: 5, max: 9 },
        mode: 'standard',
        useCharter: true,
        useCurriculumLlm: false,
      }
    }
    if (m <= 60) {
      // Rich but JSON-safe in one write invoke (~fits max_tokens)
      return {
        unitCount: { min: 1, max: 1 },
        wordsPerUnit: { min: 1000, max: 1400 },
        label: 'tek ünite · derin',
        conceptTarget: { min: 7, max: 12 },
        mode: 'deep',
        useCharter: true,
        useCurriculumLlm: true,
      }
    }
    return {
      unitCount: { min: 1, max: 1 },
      wordsPerUnit: { min: 1200, max: 1600 },
      label: 'tek ünite · 90dk ustalık',
      conceptTarget: { min: 8, max: 14 },
      mode: 'deep',
      useCharter: true,
      useCurriculumLlm: true,
    }
  }

  // path
  if (m <= 30) {
    return {
      unitCount: { min: 2, max: 2 },
      wordsPerUnit: { min: 340, max: 500 },
      label: 'yol · 2 ünite',
      conceptTarget: { min: 6, max: 10 },
      mode: 'standard',
      useCharter: true,
      useCurriculumLlm: true,
    }
  }
  if (m <= 60) {
    return {
      unitCount: { min: 3, max: 3 },
      wordsPerUnit: { min: 700, max: 1000 },
      label: 'yol · 3 ünite · 60dk',
      conceptTarget: { min: 8, max: 12 },
      mode: 'deep',
      useCharter: true,
      useCurriculumLlm: true,
    }
  }
  return {
    unitCount: { min: 3, max: 3 },
    wordsPerUnit: { min: 850, max: 1200 },
    label: 'yol · 3 ünite · 90dk ince işçilik',
    conceptTarget: { min: 10, max: 14 },
    mode: 'deep',
    useCharter: true,
    useCurriculumLlm: true,
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
      return `LENS sınav: ayırt edici fark, tipik soru kalıbı, şık tuzağı, “bunu nasıl sorarlar?”.`
    case 'homework':
      return `LENS ödev: yapılabilir adımlar, kontrol sorusu, ne yazılacağı net.`
    case 'review':
      return `LENS tekrar: yoğun ayırt ediciler, flash-değerli noktalar, hızlı tarama.`
    case 'understand':
    default:
      return `LENS anlama: neden–nasıl bağları, yanılgıyı düzelt, örnekle işlet.`
  }
}

// ——— Stage A: CHARTER ———

export function charterSystemPrompt(): string {
  return `Sen Studium öğrenme mimarı ajanısın. Kullanıcının kısa brief’ini, ChatGPT’ye 4–5 kez yazacağı netleştirme prompt’larının yerine geçen bir ÖĞRENME SÖZLEŞMESİNE çevirirsin.

Yap:
- Hedefi keskinleştir (refined_goal)
- Ölçülebilir başarı kriterleri
- Kitle kısıtı (seviye dili)
- Kapsam DIŞI (dağılmayı kes)
- Sınav/kullanım kancaları
- Varsayımlar (kullanıcıya sormadan netleştir — sonra SOURCE buna uyar)
- teaching_stance: bu oturumda nasıl öğreteceğiz (1–2 cümle)

Uzun ders anlatımı YAZMA. SADECE JSON.`
}

export function charterUserPrompt(brief: TopicBriefIn): string {
  return `Ham hedef: ${brief.goal}
Seviye: ${brief.level}
Amaç: ${brief.purpose}
Süre: ${brief.minutes} dakika
Yapı: ${brief.depth === 'path' ? 'öğrenme yolu (çok ünite)' : 'tek ünite'}
${brief.subjectHint ? `Ders: ${brief.subjectHint}\n` : ''}
JSON:
{
  "refined_goal": "netleştirilmiş hedef",
  "success_criteria": ["bitince yapabilir…"],
  "audience_constraints": "seviye dili / varsayılan bilgi",
  "out_of_scope": ["bu oturumda yok"],
  "hooks": ["sınav/kullanım kancası"],
  "assumptions": ["varsayım"],
  "teaching_stance": "nasıl öğreteceğiz"
}`
}

export function normalizeCharter(
  raw: unknown,
  brief: TopicBriefIn,
): LearningCharter {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  return {
    refined_goal:
      sanitizeText(String(o.refined_goal || brief.goal), 400) || brief.goal,
    success_criteria: asStringArray(o.success_criteria, 6, 160),
    audience_constraints:
      sanitizeText(String(o.audience_constraints || ''), 280) ||
      `${brief.level} seviyesine uygun dil`,
    out_of_scope: asStringArray(o.out_of_scope, 6, 120),
    hooks: asStringArray(o.hooks, 6, 140),
    assumptions: asStringArray(o.assumptions, 6, 160),
    teaching_stance:
      sanitizeText(String(o.teaching_stance || ''), 280) ||
      purposeLens(brief.purpose),
  }
}

// ——— Stage A0: CLARIFY (lock-in questions) ———

export function clarifySystemPrompt(): string {
  return `Sen Studium brifing ajanısın. Üretim başlamadan önce süreci KİLİTLEYECEK 2–3 soru üret.

Kurallar:
- Sorular kullanıcının verdiği konuya ÖZEL (şablon / genel gevezelik yok)
- Her soru bir kırılma noktası: anlatım açısı, kapsam sınırı, yöntem veya öncelik
- Merkez konu sabittir; sorular «bu merkeze nasıl girelim / neyi dışarıda bırakelim?» tipinde
- Her soruda 2–4 kısa, tıklanabilir seçenek
- Komşu konulara kaydıran seçenekler üretme
- Çıktı SADECE JSON`
}

export function clarifyUserPrompt(brief: TopicBriefIn): string {
  return `Merkez konu: ${brief.goal}
Seviye: ${brief.level}
Amaç: ${brief.purpose}
Süre: ${brief.minutes} dk
Yapı: ${brief.depth === 'path' ? 'öğrenme yolu' : 'tek ünite'}
${brief.subjectHint ? `Ders: ${brief.subjectHint}\n` : ''}
${centerFocusRules(brief.goal)}

JSON:
{
  "questions": [
    {
      "id": "q1",
      "prompt": "kısa soru",
      "why": "bu cevap planı nasıl kilitler (1 cümle)",
      "options": [
        { "id": "a", "label": "kısa seçenek" },
        { "id": "b", "label": "kısa seçenek" }
      ]
    }
  ]
}`
}

export function normalizeClarifyQuestions(
  raw: unknown,
  brief: TopicBriefIn,
): TopicClarifyQuestion[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const list = Array.isArray(o.questions) ? o.questions : []
  const out: TopicClarifyQuestion[] = []
  for (let i = 0; i < list.length && out.length < 3; i += 1) {
    const item = list[i]
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const prompt = sanitizeText(String(q.prompt || q.question || ''), 180)
    if (!prompt) continue
    const optsRaw = Array.isArray(q.options) ? q.options : []
    const options: Array<{ id: string; label: string }> = []
    for (let j = 0; j < optsRaw.length && options.length < 4; j += 1) {
      const opt = optsRaw[j]
      if (!opt || typeof opt !== 'object') continue
      const oo = opt as Record<string, unknown>
      const label = sanitizeText(String(oo.label || oo.text || ''), 100)
      if (!label) continue
      options.push({
        id:
          sanitizeText(String(oo.id || String.fromCharCode(97 + j)), 24) ||
          String.fromCharCode(97 + j),
        label,
      })
    }
    if (options.length < 2) continue
    out.push({
      id:
        sanitizeText(String(q.id || `q${i + 1}`), 24).replace(/\s+/g, '_') ||
        `q${i + 1}`,
      prompt,
      why: sanitizeText(String(q.why || ''), 160),
      options,
    })
  }

  if (out.length > 0) return out

  // Deterministic fallback so UI never blocks
  const g = brief.goal.slice(0, 60) || 'bu konu'
  return [
    {
      id: 'q_focus',
      prompt: `«${g}» için bu oturumda neye kilitlenelim?`,
      why: 'Kapsamı merkeze çeker',
      options: [
        { id: 'core', label: 'Sadece merkez konu — yanlara girme' },
        { id: 'bridge', label: 'Merkez + 1 kısa köprü (önkoşul)' },
        { id: 'exam', label: 'Merkez + sınav kalıbı / tuzak' },
      ],
    },
    {
      id: 'q_style',
      prompt: 'Anlatım tarzı hangisi olsun?',
      why: 'Üretim kalıbını kilitler',
      options: [
        { id: 'why', label: 'Neden–nasıl (kavram)' },
        { id: 'how', label: 'Adım adım (prosedür)' },
        { id: 'ex', label: 'Örnek üzerinden' },
      ],
    },
  ]
}

// ——— Stage B: RESEARCH ———

export function researchSystemPrompt(): string {
  return `Sen Studium konu araştırma ajanısın. PDF yok. Görevin: brief + kilit cevaplardan ÇALIŞILABİLİR kavram haritası çıkarmak.

Yap:
- MERKEZ konuya özel kavramlar (komşu konulara sapma YASAK)
- concepts[0] = merkez konu; diğerleri merkezin parçaları
- Her kavram: essence + why + links + learn_order
- connections, misconceptions, worked_seeds
- must_learn: ölçülebilir kazanımlar (merkeze dair)
- pattern öner

Uzun anlatım YOK — araştırma JSON.`
}

export function researchUserPrompt(
  brief: TopicBriefIn,
  capacity: ReturnType<typeof planCapacity>,
  charter: LearningCharter | null,
): string {
  const charterBlock = charter
    ? `CHARTER:
refined_goal: ${charter.refined_goal}
success: ${charter.success_criteria.join(' · ') || '—'}
stance: ${charter.teaching_stance}
out_of_scope: ${charter.out_of_scope.join(' · ') || '—'}
hooks: ${charter.hooks.join(' · ') || '—'}
assumptions: ${charter.assumptions.join(' · ') || '—'}
audience: ${charter.audience_constraints}
`
    : ''

  return `${charterBlock}${centerFocusRules(brief.goal)}
${locksBlock(brief)}Ham hedef (MERKEZ): ${brief.goal}
Seviye: ${brief.level} · Amaç: ${brief.purpose}
Süre: ${brief.minutes} dk (${capacity.label}) · mod ${capacity.mode}
Ünite: ${capacity.unitCount.min}–${capacity.unitCount.max}
Kavram hedefi: ${capacity.conceptTarget.min}–${capacity.conceptTarget.max}
${brief.subjectHint ? `Ders: ${brief.subjectHint}\n` : ''}
JSON:
{
  "book_title": "merkeze bağlı kısa başlık",
  "subject": "ders veya null",
  "pattern": "concept|procedure|compare|system|timeline|applied",
  "pattern_reason": "1 cümle",
  "audience_note": "1 cümle",
  "core_claim": "merkez konudaki ustalık tek cümle",
  "prerequisites": ["yalnızca 1–2 kısa köprü veya boş"],
  "concepts": [
    {
      "id": "c1",
      "name": "MERKEZ konu adı",
      "essence": "ne (1–2 cümle)",
      "why": "neden bu hedef için",
      "links_to": ["c2"],
      "learn_order": 1
    }
  ],
  "connections": [{"from":"c1","to":"c2","relation":"parça|sonuç"}],
  "misconceptions": ["yanlış → doğru"],
  "worked_seeds": ["örnek tohumu"],
  "must_learn": ["merkeze dair ölçülebilir kazanım"]
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
        `${name} — bu hedefteki yeri`,
      why:
        sanitizeText(String(c.why || c.relevance || ''), 240) ||
        `“${brief.goal}” için gerekli`,
      links_to: asStringArray(c.links_to, 6, 24),
      learn_order:
        Number.isFinite(orderRaw) && orderRaw > 0 ? Math.round(orderRaw) : i + 1,
    })
  }

  // Force center: concepts[0] must be the user's goal (not a neighbor topic)
  const centerName = sanitizeText(brief.goal, 100) || 'Merkez konu'
  if (concepts.length === 0) {
    const g = centerName.slice(0, 80)
    concepts.push(
      {
        id: 'c1',
        name: g,
        essence: `${g} çekirdek tanımı`,
        why: 'Kullanıcının verdiği merkez',
        links_to: ['c2'],
        learn_order: 1,
      },
      {
        id: 'c2',
        name: 'Uygulama',
        essence: 'Somut örnekle işletme',
        why: 'Anlamayı ölçmek',
        links_to: [],
        learn_order: 2,
      },
    )
  }

  concepts.sort((a, b) => a.learn_order - b.learn_order)
  // Pin user goal as first concept name if model drifted to a neighbor
  if (concepts.length > 0) {
    const head = concepts[0]!
    const goalLower = centerName.toLowerCase()
    const headLower = head.name.toLowerCase()
    const centered =
      headLower.includes(goalLower.slice(0, Math.min(18, goalLower.length))) ||
      goalLower.includes(headLower.slice(0, Math.min(18, headLower.length)))
    if (!centered) {
      concepts.unshift({
        id: 'c0',
        name: centerName,
        essence: `${centerName} — oturumun tek merkezi`,
        why: 'Kullanıcının verdiği konu',
        links_to: [head.id],
        learn_order: 0,
      })
    } else {
      head.name = centerName
      head.why = head.why || 'Kullanıcının verdiği merkez'
      head.learn_order = 1
    }
  }
  const capped = concepts.slice(0, capacity.conceptTarget.max)
  // Keep prerequisites short — bridges only, not a second curriculum
  const prerequisites = asStringArray(o.prerequisites, 2, 100)

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
  if (connections.length === 0) {
    for (const c of capped) {
      for (const to of c.links_to) {
        connections.push({ from: c.id, to, relation: 'bağ' })
      }
    }
  }

  let mustLearn = asStringArray(o.must_learn, 12, 160)
  if (mustLearn.length === 0) {
    mustLearn = capped
      .slice(0, 8)
      .map((c) => `${c.name}: ${c.essence.slice(0, 80)}`)
  }

  const titleFromGoal =
    sanitizeText(brief.goal, 120) || bookTitle
  const finalTitle =
    bookTitle.toLowerCase().includes(centerName.slice(0, 12).toLowerCase()) ||
    centerName.toLowerCase().includes(bookTitle.slice(0, 12).toLowerCase())
      ? bookTitle
      : titleFromGoal

  return {
    book_title: finalTitle,
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
    prerequisites,
    concepts: capped,
    connections: connections.slice(0, 28),
    misconceptions: asStringArray(o.misconceptions, 8, 200),
    worked_seeds: asStringArray(o.worked_seeds, 8, 160),
    must_learn: mustLearn,
  }
}

// ——— Stage C: CURRICULUM (LLM) or CLUSTER (code) ———

function chunkByCount<T>(items: T[], parts: number): T[][] {
  const n = Math.max(1, Math.min(parts, items.length))
  if (n === 1) return [items]
  const out: T[][] = Array.from({ length: n }, () => [])
  items.forEach((item, i) => {
    const bucket = Math.min(n - 1, Math.floor((i * n) / items.length))
    out[bucket].push(item)
  })
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].length === 0 && items.length) {
      out[i].push(items[Math.min(i, items.length - 1)])
    }
  }
  return out.filter((b) => b.length > 0)
}

function emptyUnitExtras(): Pick<
  OutlineUnit,
  | 'timed_beats'
  | 'deep_dives'
  | 'teacher_prompts'
  | 'checkpoint'
  | 'practice_prompt'
  | 'worked_example'
> {
  return {
    timed_beats: [],
    deep_dives: [],
    teacher_prompts: [],
    checkpoint: '',
    practice_prompt: '',
    worked_example: '',
  }
}

export function clusterResearchIntoUnits(
  research: TopicResearch,
  brief: TopicBriefIn,
  capacity: ReturnType<typeof planCapacity>,
  charter: LearningCharter | null = null,
): TopicOutline {
  const unitN =
    brief.depth === 'one'
      ? 1
      : Math.min(capacity.unitCount.max, capacity.unitCount.min)

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
          const a =
            research.concepts.find((x) => x.id === c.from)?.name || c.from
          const b = research.concepts.find((x) => x.id === c.to)?.name || c.to
          return `Bağ: ${a} → ${b} (${c.relation})`
        }),
      ...research.misconceptions.slice(i, i + 2),
    ].slice(0, 10)

    return {
      title: sanitizeText(title, 160),
      objective: sanitizeText(
        research.must_learn[i] ||
          `Bu ünite bitince ${names.slice(0, 2).join(' ve ')} açıklayabilir`,
        280,
      ),
      minutes: minutesEach,
      summary: sanitizeText(names.join(' · ') || title, 600),
      key_concepts: names.slice(0, 8),
      must_cover,
      worked_hooks: research.worked_seeds.slice(i, i + 2),
      concept_ids: nodes.map((n) => n.id),
      ...emptyUnitExtras(),
      teacher_prompts: charter
        ? [
            `Hedefi ${charter.refined_goal} bağlamında işle`,
            ...charter.hooks.slice(0, 2),
          ]
        : [],
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
    charter,
  }
}

export function curriculumSystemPrompt(): string {
  return `Sen Studium müfredat mimarı ajanısın. Araştırma grafiğini SÜREYE YAYILMIŞ oturum planına çevirirsin.
Aynı yanıtta kısa bir learning charter da üret.

ZORUNLU: Kullanıcının verdiği merkez konuyu anlat — komşu konulara müfredat açma.
Kilit cevaplar varsa planı onlara kilitle.

Her ünite (arc):
- minutes (toplam brief.minutes’a yakın)
- timed_beats: 3–6 adım (dakika + focus) — hepsi merkez etrafında
- must_cover + deep_dives
- teacher_prompts (3–5)
- checkpoint, practice_prompt, worked_example
- concept_ids: araştırmadaki id’ler

Çıktı SADECE JSON. Yüzeysel tek paragraf plan yazma.`
}

export function curriculumUserPrompt(input: {
  brief: TopicBriefIn
  capacity: ReturnType<typeof planCapacity>
  charter: LearningCharter | null
  research: TopicResearch
}): string {
  const { brief, capacity, charter, research } = input
  const conceptLines = research.concepts
    .map(
      (c) =>
        `- ${c.id}: ${c.name} | ${c.essence} | why: ${c.why} | order ${c.learn_order}`,
    )
    .join('\n')

  return `${centerFocusRules(brief.goal)}
${locksBlock(brief)}Süre: ${brief.minutes} dk · ${capacity.label} · mod ${capacity.mode}
Ünite sayısı: TAM ${capacity.unitCount.max}
Amaç: ${brief.purpose} · Seviye: ${brief.level}
${charter ? `Charter hedef: ${charter.refined_goal}\nStance: ${charter.teaching_stance}\nSuccess: ${charter.success_criteria.join(' · ')}\n` : ''}
Pattern: ${research.pattern} (${research.pattern_reason})
Core: ${research.core_claim}
must_learn: ${research.must_learn.join(' · ')}
misconceptions: ${research.misconceptions.join(' || ')}
seeds: ${research.worked_seeds.join(' | ')}

Kavramlar (c1/ilk = MERKEZ):
${conceptLines}

JSON:
{
  "book_title": "${research.book_title.replace(/"/g, '')}",
  "charter": {
    "refined_goal": "net hedef",
    "success_criteria": ["…"],
    "audience_constraints": "…",
    "out_of_scope": ["…"],
    "hooks": ["…"],
    "assumptions": ["…"],
    "teaching_stance": "…"
  },
  "arcs": [
    {
      "title": "ünite başlığı",
      "objective": "ölçülebilir kazanım",
      "minutes": 30,
      "summary": "1–2 cümle",
      "concept_ids": ["c1","c2"],
      "key_concepts": ["…"],
      "must_cover": ["somut beat"],
      "deep_dives": ["ince detay"],
      "timed_beats": [{"minutes": 5, "focus": "ne yapılır"}],
      "teacher_prompts": ["hazır soru"],
      "checkpoint": "ara kontrol",
      "practice_prompt": "kısa alıştırma",
      "worked_example": "örnek iskeleti",
      "worked_hooks": ["…"]
    }
  ]
}`
}

export function normalizeCurriculum(
  raw: unknown,
  research: TopicResearch,
  brief: TopicBriefIn,
  capacity: ReturnType<typeof planCapacity>,
  charter: LearningCharter | null,
): TopicOutline {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const mergedCharter =
    o.charter && typeof o.charter === 'object'
      ? normalizeCharter(o.charter, brief)
      : charter
  const arcs = Array.isArray(o.arcs)
    ? o.arcs
    : Array.isArray(o.chapters)
      ? o.chapters
      : []
  const maxU = capacity.unitCount.max
  const chapters: OutlineUnit[] = []

  for (let i = 0; i < arcs.length && chapters.length < maxU; i += 1) {
    const item = arcs[i]
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const title = sanitizeText(String(a.title || ''), 160)
    if (!title) continue

    const conceptIds = asStringArray(a.concept_ids, 10, 24)
    const resolvedIds =
      conceptIds.length > 0
        ? conceptIds
        : research.concepts
            .slice(
              Math.floor((i * research.concepts.length) / maxU),
              Math.floor(((i + 1) * research.concepts.length) / maxU) ||
                undefined,
            )
            .map((c) => c.id)

    const beatsRaw = Array.isArray(a.timed_beats) ? a.timed_beats : []
    const timed_beats: TimedBeat[] = []
    for (const b of beatsRaw) {
      if (!b || typeof b !== 'object') continue
      const bb = b as Record<string, unknown>
      const mins = Number(bb.minutes)
      const focus = sanitizeText(String(bb.focus || ''), 160)
      if (!focus) continue
      timed_beats.push({
        minutes:
          Number.isFinite(mins) && mins > 0 ? Math.min(45, Math.round(mins)) : 5,
        focus,
      })
    }

    const minutesRaw = Number(a.minutes)
    chapters.push({
      title,
      objective:
        sanitizeText(String(a.objective || ''), 280) ||
        research.must_learn[i] ||
        title,
      minutes:
        Number.isFinite(minutesRaw) && minutesRaw > 0
          ? Math.min(90, Math.round(minutesRaw))
          : Math.round(brief.minutes / maxU),
      summary: sanitizeText(String(a.summary || title), 600),
      key_concepts: asStringArray(a.key_concepts, 8, 80),
      must_cover: asStringArray(a.must_cover, 10, 180),
      worked_hooks: asStringArray(a.worked_hooks, 5, 160),
      concept_ids: resolvedIds,
      timed_beats: timed_beats.slice(0, 8),
      deep_dives: asStringArray(a.deep_dives, 6, 180),
      teacher_prompts: asStringArray(a.teacher_prompts, 8, 180),
      checkpoint: sanitizeText(String(a.checkpoint || ''), 200),
      practice_prompt: sanitizeText(String(a.practice_prompt || ''), 200),
      worked_example: sanitizeText(String(a.worked_example || ''), 400),
    })
  }

  if (chapters.length === 0) {
    return clusterResearchIntoUnits(
      research,
      brief,
      capacity,
      mergedCharter,
    )
  }

  // Fill thin arcs from research so writer never starves
  const filled = chapters.map((ch, i) => {
    const nodes = research.concepts.filter((c) =>
      ch.concept_ids.includes(c.id),
    )
    const must =
      ch.must_cover.length > 0
        ? ch.must_cover
        : nodes.map((n) => `${n.name}: ${n.essence}`).slice(0, 6)
    const hooks =
      ch.worked_hooks.length > 0
        ? ch.worked_hooks
        : research.worked_seeds.slice(i, i + 2)
    return {
      ...ch,
      must_cover: must,
      worked_hooks: hooks,
      key_concepts:
        ch.key_concepts.length > 0
          ? ch.key_concepts
          : nodes.map((n) => n.name).slice(0, 8),
    }
  })

  return {
    book_title:
      sanitizeText(String(o.book_title || research.book_title), 120) ||
      research.book_title,
    subject: research.subject,
    pattern: research.pattern,
    pattern_reason: research.pattern_reason,
    audience_note: research.audience_note,
    core_claim: research.core_claim,
    chapters: filled,
    research,
    charter: mergedCharter,
  }
}

// ——— Stage D: WRITE ———

export function writeUnitSystemPrompt(
  pattern: TeachPattern,
  purpose: TopicPurpose,
  mode: PipelineMode,
): string {
  const depthNote =
    mode === 'deep'
      ? `DERİN MOD: timed_beats’i dakika dakika izle; deep_dives’ı işle; teacher_prompts’a cevap verir gibi yaz; checkpoint + practice_prompt’u metne göm. Tek sayfalık ChatGPT özeti YASAK — ciddi ders kaynağı yaz.`
      : mode === 'standard'
        ? `STANDART: must_cover + en az bir örnek + bir yanılgı.`
        : `LITE: yoğun ve kısa; gevezelik yok.`

  return `Sen Studium ünite yazarısın. Müfredat ajanının hazırladığı brief’ten KAYNAK (SOURCE) üretirsin — sıfırdan uydurma.

${patternBlueprint(pattern)}
${purposeLens(purpose)}
${depthNote}

Kurallar:
- MERKEZ konuyu anlat; bağlantılı konulara kayma — en fazla 1–2 cümle köprü.
- Kilit cevaplar varsa onlara uy.
- Charter/araştırma/müfredattaki somut noktaları KULLAN.
- Türkçe; ## başlık + madde + açıklayıcı paragraf (sadece madde listesi yetmez).
- Nicel: varsayım, formül düz metin, mini sayısal adım.
- Kelime hedefini ALTINA düşme; 1 sayfalık özet kabul edilmez.
- Çıktı SADECE JSON: {"page_text","title","summary","key_concepts"}
- page_text ana alanda; fence yok.`
}

export function writeUnitUserPrompt(input: {
  brief: TopicBriefIn
  outline: TopicOutline
  unit: OutlineUnit
  words: { min: number; max: number }
  unitIndex: number
  unitTotal: number
  mode: PipelineMode
}): string {
  const { brief, outline, unit, words, unitIndex, unitTotal, mode } = input
  const research = outline.research
  const charter = outline.charter
  const nodes = research.concepts.filter((c) =>
    unit.concept_ids.includes(c.id),
  )
  const nodeBlock = nodes
    .map(
      (n) =>
        `- [${n.id}] ${n.name}\n  öz: ${n.essence}\n  neden: ${n.why}`,
    )
    .join('\n')

  const beats =
    unit.timed_beats.length > 0
      ? unit.timed_beats
          .map((b, i) => `${i + 1}. (${b.minutes} dk) ${b.focus}`)
          .join('\n')
      : '—'

  return `${centerFocusRules(brief.goal)}
${locksBlock(brief)}Kitap: ${outline.book_title}
Ham hedef (MERKEZ): ${brief.goal}
${charter ? `Charter: ${charter.refined_goal}\nStance: ${charter.teaching_stance}\n` : ''}
Ustalık: ${outline.core_claim}
Seviye: ${brief.level} · Amaç: ${brief.purpose} · Toplam ${brief.minutes} dk · mod ${mode}
Kalıp: ${outline.pattern}

Ünite ${unitIndex}/${unitTotal} · ~${unit.minutes} dk
Başlık: ${unit.title}
Kazanım: ${unit.objective}

Kavramlar:
${nodeBlock || '—'}

Zaman çizelgesi (timed_beats):
${beats}

must_cover:
${unit.must_cover.map((x, i) => `${i + 1}. ${x}`).join('\n') || '—'}

deep_dives:
${unit.deep_dives.map((x, i) => `${i + 1}. ${x}`).join('\n') || '—'}

teacher_prompts (bunlara cevap verir gibi yaz):
${unit.teacher_prompts.map((x, i) => `${i + 1}. ${x}`).join('\n') || '—'}

worked_example: ${unit.worked_example || unit.worked_hooks.join(' | ') || '—'}
checkpoint: ${unit.checkpoint || '—'}
practice_prompt: ${unit.practice_prompt || '—'}
Yanılgılar: ${research.misconceptions.slice(0, 4).join(' || ') || '—'}

Kelime hedefi (ZORUNLU aralık): ${words.min}–${words.max}
page_text bu aralıkta olsun; daha kısa = başarısız.

JSON: {"title","summary","key_concepts","page_text"}`
}

export function writeBatchSystemPrompt(
  pattern: TeachPattern,
  purpose: TopicPurpose,
  mode: PipelineMode,
): string {
  return `${writeUnitSystemPrompt(pattern, purpose, mode)}

TOPLU YAZIM: Tüm üniteleri TEK JSON’da döndür.
Her ünite kendi timed_beats / must_cover / deep_dives’ını işlesin; tekrar etme.
{"chapters":[{"title","summary","key_concepts","page_text"}]}`
}

export function writeBatchUserPrompt(input: {
  brief: TopicBriefIn
  outline: TopicOutline
  words: { min: number; max: number }
  mode: PipelineMode
}): string {
  const { brief, outline, words, mode } = input
  const blocks = outline.chapters
    .map((unit, i) => {
      return writeUnitUserPrompt({
        brief,
        outline,
        unit,
        words,
        unitIndex: i + 1,
        unitTotal: outline.chapters.length,
        mode,
      })
    })
    .join('\n\n====\n\n')

  return `Aşağıdaki ${outline.chapters.length} üniteyi tek JSON chapters dizisinde yaz.
Her page_text ${words.min}–${words.max} kelime.

${blocks}

JSON: {"chapters":[{"title","summary","key_concepts","page_text"}]}`
}

export function coerceWritePayload(raw: unknown): Record<string, unknown> {
  let o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (
    Array.isArray(o.chapters) &&
    o.chapters[0] &&
    typeof o.chapters[0] === 'object'
  ) {
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
    unit.timed_beats.length
      ? `### Zaman\n${unit.timed_beats.map((b) => `- ${b.minutes} dk: ${b.focus}`).join('\n')}`
      : '',
    '',
    '### Kapsam',
    ...unit.must_cover.map((m) => `- ${m}`),
    '',
    unit.deep_dives.length
      ? `### İnce detay\n${unit.deep_dives.map((d) => `- ${d}`).join('\n')}`
      : '',
    '',
    'Müfredat iskeleti — Anlatım’da Üret ile genişlet.',
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
    title:
      sanitizeText(String(o.title || fallback.title), 160) || fallback.title,
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

export function researchHeader(
  research: TopicResearch,
  charter: LearningCharter | null,
): string {
  return [
    '--- Topic research ---',
    charter ? `charter: ${charter.refined_goal}` : '',
    `core: ${research.core_claim}`,
    `pattern: ${research.pattern} — ${research.pattern_reason}`,
    `must_learn: ${research.must_learn.slice(0, 8).join(' · ')}`,
    `concepts: ${research.concepts.map((c) => c.name).join(' · ')}`,
    '',
  ]
    .filter(Boolean)
    .join('\n')
}
