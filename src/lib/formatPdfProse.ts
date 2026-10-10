import { repairTurkishText } from './repairTurkish'

/**
 * PDF düz metnini okunaklı, görsel Studium markdown’ına çevir.
 * Soft wrap (cümle ortası satır kırığı) birleştirilir; fazla boşluklar sıkılır.
 */
export function formatPageAsStudyProse(raw: string): string {
  try {
    return formatPageAsStudyProseInner(raw)
  } catch (err) {
    console.error('formatPageAsStudyProse failed', err)
    return repairTurkishText(String(raw || '')).trim()
  }
}

/**
 * "Satış Türleri Başvuru Süreci" gibi yan yana birleşmiş iki sütun başlığı.
 */
export function splitDualColumnTitles(line: string): [string, string] | null {
  let t = String(line || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
  if (!t || t.length < 10 || t.length > 100) return null
  if (/[.!?…,;:]/.test(t)) return null
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 4 || words.length > 12) return null
  for (let mid = 2; mid <= words.length - 2; mid += 1) {
    const a = words.slice(0, mid).join(' ')
    const b = words.slice(mid).join(' ')
    if (looksLikeBoxTitle(a) && looksLikeBoxTitle(b)) return [a, b]
  }
  return null
}

/**
 * İki sütunun satır satır birleştirildiği bozuk düzen (Studium’da görsele düş).
 */
export function looksLikeBrokenTwoColumnLayout(raw: string): boolean {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
  if (lines.length < 2) return false

  let dualTitles = 0
  let dualBodies = 0
  for (const line of lines.slice(0, 24)) {
    const plain = line.replace(/^#{1,6}\s+/, '').replace(/^!\[[^\]]*\]\([^)]*\)/, '')
    if (!plain || plain.startsWith('<!--')) continue
    if (splitDualColumnTitles(plain)) {
      dualTitles += 1
      continue
    }
    // Uzun satırda iki büyük harfle başlayan yarı
    if (looksLikeInterleavedColumnLine(plain)) dualBodies += 1
  }

  // "Satış Türleri Başvuru Süreci" tek satırda bile yeterli sinyal
  if (dualTitles >= 1) return true
  if (dualBodies >= 3) return true
  return false
}

function looksLikeInterleavedColumnLine(line: string): boolean {
  const t = line.trim()
  if (t.length < 24 || t.length > 220) return false
  if (/^[-*+•]|\d+[.)]/.test(t)) return false
  // İki Title-Case / cümle parçası yan yana
  const m = t.match(
    /^([A-ZÇĞİÖŞÜÁÉÍÓÚ][^A-ZÇĞİÖŞÜ]{6,70}?)\s+([A-ZÇĞİÖŞÜÁÉÍÓÚ].{6,70})$/,
  )
  if (!m) return false
  const left = m[1]!.trim()
  const right = m[2]!.trim()
  const lw = left.split(/\s+/).length
  const rw = right.split(/\s+/).length
  return lw >= 2 && rw >= 2 && lw <= 14 && rw <= 14
}

/** Birleşmiş çift başlık satırlarını alt alta ayır. */
function expandDualColumnTitles(text: string): string {
  return String(text || '')
    .split('\n')
    .map((raw) => {
      const dual = splitDualColumnTitles(raw)
      if (!dual) return raw
      const heading = /^#{1,6}\s+/.test(raw.trim())
      if (heading) return `### ${dual[0]}\n\n### ${dual[1]}`
      return `${dual[0]}\n${dual[1]}`
    })
    .join('\n')
}

function formatPageAsStudyProseInner(raw: string): string {
  const trimmed = repairTurkishText(String(raw || '').replace(/\u00ad/g, '')).trim()
  if (!trimmed) return ''

  // 0) "Satış Türleri Başvuru Süreci" → iki satır
  let text = expandDualColumnTitles(trimmed)
  // 1) Eski kutu tabloları → dikey bölüm
  text = convertBoxTablesToSections(text)
  // 2) Üst üste kutu başlıkları + karışık gövde
  text = rebuildStackedConceptBoxes(text)
  // 3) Soft wrap
  text = reflowSoftWraps(text)
  // 4) Reflow sonrası tekrar kutu (başlıklar ayrıldıysa)
  text = rebuildStackedConceptBoxes(text)
  // 5) Düz satırları markdown başlığa yükselt (her zaman)
  text = promoteHeadingsInText(text)
  // 6) Yanlış başlık + küçük harfle devam → tek paragraf
  text = demoteBrokenHeadings(text)

  if (/^\|.+\|\s*$/m.test(text) && (text.match(/\|/g) || []).length >= 4) {
    // Gerçek GFM tablo — yapısal satırları koru, yine de başlık promote et
    return repairTurkishText(tightenBlocks(text))
  }

  if (looksLikeMarkdown(text)) {
    return repairTurkishText(tightenBlocks(text))
  }

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())

  const out: string[] = []
  let para: string[] = []
  let listMode: 'ul' | 'ol' | null = null
  let listBuf: string[] = []
  let tableBuf: string[] = []

  const flushPara = () => {
    if (!para.length) return
    let t = para.join(' ').replace(/\s+/g, ' ').trim()
    para = []
    if (!t) return
    t = emphasizeInline(t)
    out.push(t)
  }

  const flushList = () => {
    if (!listBuf.length) return
    out.push(listBuf.join('\n'))
    listBuf = []
    listMode = null
  }

  const flushTable = () => {
    if (!tableBuf.length) return
    out.push(tableBuf.join('\n'))
    tableBuf = []
  }

  for (const line of lines) {
    if (!line) {
      flushPara()
      flushList()
      flushTable()
      continue
    }

    // Zaten markdown başlık
    if (/^#{1,6}\s+\S/.test(line)) {
      flushPara()
      flushList()
      flushTable()
      out.push(line)
      continue
    }

    // Tablo / şekil görselleri (data URL)
    if (isMarkdownImageLine(line)) {
      flushPara()
      flushList()
      flushTable()
      out.push(line)
      continue
    }

    const heading = classifyHeading(line)
    if (heading) {
      flushPara()
      flushList()
      flushTable()
      out.push(`${heading.level} ${heading.title}`)
      continue
    }

    const bullet = line.match(/^([•●▪‣·]|[-–—*])\s+(.+)$/)
    if (bullet) {
      flushPara()
      flushTable()
      if (listMode && listMode !== 'ul') flushList()
      listMode = 'ul'
      listBuf.push(`- ${emphasizeInline(bullet[2]!.trim())}`)
      continue
    }

    const numbered = line.match(/^(\d+)[.)]\s+(.+)$/)
    if (numbered && numbered[2]!.length > 2) {
      flushPara()
      flushTable()
      if (listMode && listMode !== 'ol') flushList()
      listMode = 'ol'
      listBuf.push(`1. ${emphasizeInline(numbered[2]!.trim())}`)
      continue
    }

    const callout = asCallout(line)
    if (callout) {
      flushPara()
      flushList()
      flushTable()
      out.push(callout)
      continue
    }

    if (isTableRowLine(line) || /^<!--\s*study:boxes\s*-->/.test(line)) {
      flushPara()
      flushList()
      tableBuf.push(line)
      continue
    }

    flushTable()
    if (listMode) flushList()
    para.push(line)
  }

  flushPara()
  flushList()
  flushTable()

  if (!out.length) {
    return fallbackParagraphs(raw)
  }

  return tightenBlocks(
    out
      .map((block, i) => {
        if (block.startsWith('# ') && i > 0) return `---\n\n${block}`
        return block
      })
      .join('\n\n'),
  )
}

/** Düz satırları (ve soft-wrap sonrası kaçanları) markdown başlığa çevir. */
function promoteHeadingsInText(text: string): string {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
  const out: string[] = []

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+/g, ' ').trim()
    if (!line) {
      out.push('')
      continue
    }
    if (/^#{1,6}\s+\S/.test(line)) {
      out.push(line)
      continue
    }
    if (
      isMarkdownImageLine(line) ||
      isTableRowLine(line) ||
      /^<!--/.test(line) ||
      /^>\s*\S/.test(line)
    ) {
      out.push(line)
      continue
    }
    if (/^[-*+•●▪‣·]\s+\S/.test(line) || /^\d+[.)]\s+\S/.test(line)) {
      out.push(line)
      continue
    }
    const heading = classifyHeading(line)
    if (heading) {
      out.push(`${heading.level} ${heading.title}`)
      continue
    }
    out.push(line)
  }

  return out.join('\n')
}

/**
 * `# Konu şu… yönetim` + `kontrolünün…` gibi kırıkları düzelt.
 * Sonraki satır küçük harfle devam ediyorsa başlığı kaldırıp birleştir.
 */
function demoteBrokenHeadings(text: string): string {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const line = raw.replace(/[ \t]+/g, ' ').trim()
    const hm = line.match(/^(#{1,6})\s+(.+)$/)
    if (hm) {
      const title = hm[2]!.trim()
      // Başlık aslında prose mi?
      const proseTitle = looksLikeProsePhrase(title) || /[,;]$/.test(title)
      let j = i + 1
      while (j < lines.length && !(lines[j] ?? '').trim()) j += 1
      const next = (lines[j] ?? '').replace(/[ \t]+/g, ' ').trim()
      const nextContinues =
        !!next &&
        !/^#{1,6}\s/.test(next) &&
        !isMarkdownImageLine(next) &&
        /^[a-zçğıöşüâêîôû(]/.test(next)

      if (proseTitle || nextContinues) {
        let merged = title
        if (nextContinues) {
          merged = `${title} ${next}`.replace(/\s+/g, ' ').trim()
          i = j
        }
        out.push(merged)
        continue
      }
    }
    out.push(raw)
  }

  return out.join('\n')
}

function appendSoftWrap(buf: string, line: string): string {
  if (/[-\u2010\u2011\u00ad]$/.test(buf)) {
    return buf.replace(/[-\u2010\u2011\u00ad]$/, '') + line
  }
  return `${buf} ${line}`
}

/** PDF satır sarmalamasını cümle bütünlüğüne çevir. */
function reflowSoftWraps(text: string): string {
  const rawLines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let buf = ''
  // Boş satırı hemen paragraf yapma — sonraki satıra bakıp soft wrap ise yut
  let pendingBlank = false

  const flush = () => {
    if (buf) {
      out.push(buf.replace(/\s+/g, ' ').trim())
      buf = ''
    }
  }

  const emitBlankIfNeeded = () => {
    if (pendingBlank && out.length && out[out.length - 1] !== '') {
      out.push('')
    }
    pendingBlank = false
  }

  for (const raw of rawLines) {
    const line = raw.replace(/[ \t]+/g, ' ').trim()

    if (!line) {
      pendingBlank = true
      continue
    }

    if (isStructuralLine(line)) {
      flush()
      emitBlankIfNeeded()
      out.push(line)
      continue
    }

    if (!buf) {
      // Önceki flush edilmiş satır cümle ortasında kaldıysa boşluğu yut
      if (
        pendingBlank &&
        out.length &&
        out[out.length - 1] !== '' &&
        shouldJoinSoftWrap(out[out.length - 1]!, line)
      ) {
        const prev = out.pop()!
        buf = appendSoftWrap(prev, line)
        pendingBlank = false
        continue
      }
      emitBlankIfNeeded()
      buf = line
      continue
    }

    // Buf varken: soft wrap veya “sahte” paragraf boşluğu → birleştir
    if (shouldJoinSoftWrap(buf, line) || pendingBlank) {
      if (pendingBlank && !shouldJoinSoftWrap(buf, line)) {
        flush()
        emitBlankIfNeeded()
        buf = line
        continue
      }
      buf = appendSoftWrap(buf, line)
      pendingBlank = false
      continue
    }

    flush()
    pendingBlank = false
    buf = line
  }
  flush()

  return out.join('\n')
}

function isTableRowLine(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  if (/^\|?\s*:?-{3,}/.test(t)) return true
  return /^\|.+\|/.test(t) || /\|.+\|/.test(t)
}

function isMarkdownImageLine(line: string): boolean {
  const t = line.trim()
  return /^!\[[^\]]*\]\(\s*data:image\/[a-zA-Z0-9+.-]+;base64,/.test(t) ||
    /^!\[[^\]]*\]\([^)\s]+\)/.test(t)
}

function isStructuralLine(line: string): boolean {
  return (
    /^#{1,6}\s+\S/.test(line) ||
    /^[-*+•●▪‣·]\s+\S/.test(line) ||
    /^\d+[.)]\s+\S/.test(line) ||
    /^>\s*\S/.test(line) ||
    /^---+$/.test(line) ||
    /^<!--/.test(line) ||
    /^\*[^\n]+\*$/.test(line) ||
    isMarkdownImageLine(line) ||
    isTableRowLine(line) ||
    Boolean(classifyHeading(line)) ||
    looksLikeBoxTitle(line)
  )
}

/**
 * Önceki satır cümle bitirmemişse / sonraki satır devam gibi görünüyorsa birleştir.
 */
function shouldJoinSoftWrap(prev: string, next: string): boolean {
  // Küçük harfle devam → cümle ortası (sahte başlığı da birleştir)
  if (/^[a-zçğıöşüâêîôû(]/.test(next) && !/[.!?…]$/.test(prev)) {
    if (!isMarkdownImageLine(prev) && !isTableRowLine(prev) && !/^<!--/.test(prev)) {
      return true
    }
  }

  if (isStructuralLine(prev) || isStructuralLine(next)) return false

  // Başlık / kutu başlığı satırlarını soft-wrap ile birleştirme
  if (classifyHeading(prev) || classifyHeading(next)) return false
  if (looksLikeBoxTitle(prev) || looksLikeBoxTitle(next)) return false

  // Tire ile bölünmüş kelime
  if (/[-\u2010\u2011\u00ad]$/.test(prev)) return true

  // Cümle bitti → yeni paragraf adayı
  if (/[.!?…]$/.test(prev)) return false
  if (/[:;]$/.test(prev) && /^[A-ZÇĞİÖŞÜÁÉÍÓÚ0-9“"«(]/.test(next)) {
    return prev.length < 40
  }

  // Küçük harfle devam = kesin soft wrap
  if (/^[a-zçğıöşüâêîôû(]/.test(next)) return true

  // Önceki satır kısa/orta ve noktalama yok → PDF satır kırığı
  if (prev.length <= 90 && !/[.!?…]$/.test(prev)) return true

  if (
    /\b(ve|veya|ile|veyâ|ki|da|de|bir|bu|şu|o|için|olan|olarak|gibi|kadar|ancak|ama|fakat)\s*$/i.test(
      prev,
    )
  ) {
    return true
  }

  return false
}

/** Fazla boş satır / baş-son boşluk temizliği. */
function tightenBlocks(text: string): string {
  return repairTurkishText(
    text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^(?:---\n\n)+/g, '')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .trim(),
  )
}

function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return false
  let score = 0
  for (const line of lines.slice(0, 40)) {
    const t = line.trim()
    if (/^#{1,3}\s+\S/.test(t)) score += 2
    else if (/^[-*+]\s+\S/.test(t) || /^\d+\.\s+\S/.test(t)) score += 1
    else if (/^>\s+\S/.test(t)) score += 1
    else if (/^---+$/.test(t)) score += 1
    else if (isMarkdownImageLine(t)) score += 2
    else if (isTableRowLine(t)) score += 2
    else if (/<!--\s*study:boxes\s*-->/.test(t)) score += 2
  }
  return score >= 2
}

/** Cümle / paragraf — başlık değil. */
function looksLikeProsePhrase(s: string): boolean {
  const t = String(s || '').trim()
  if (!t) return false
  if (/[,;]/.test(t)) return true
  if (t.length > 55) return true
  if (t.split(/\s+/).length > 8) return true
  return /\b(için|olarak|olan|üzere|nedeniyle|ancak|fakat|edilir|edilmesi|olunması|kabul|hale|kapsamında|sahip|veren|nedeniyle)\b/i.test(
    t,
  )
}

/** "Konu şu üyelikler…" gibi bölüm anahtarı + düz cümle. */
function looksLikeChapterProseRest(rest: string): boolean {
  const t = String(rest || '').trim()
  if (!t) return false
  if (looksLikeProsePhrase(t)) return true
  if (/^(şu|bu|bir|ile|ve|veya)\b/i.test(t)) return true
  if (t.split(/\s+/).length > 6) return true
  return false
}

function classifyHeading(
  line: string,
): { level: '#' | '##' | '###'; title: string } | null {
  const t = String(line || '').trim()
  if (!t || t.length > 100 || /[.!?…]$/.test(t)) return null
  if (/^\|/.test(t) || /^<!--/.test(t) || /^>\s/.test(t)) return null
  // Zaten başlık — tekrar sınıflandırma
  if (/^#{1,6}\s+\S/.test(t)) return null
  // Virgülle biten / cümle ortası satır başlık değil
  if (/[,;]$/.test(t) || looksLikeProsePhrase(t)) return null

  const chapter = t.match(
    /^(Bölüm|Chapter|Unit|Ünite|Konu|Kısım|Part|Section)\b(.*)$/i,
  )
  if (chapter) {
    const kw = chapter[1]!
    let rest = (chapter[2] || '').trim()
    // "Konu şu üyelikler…" → prose, başlık değil
    if (rest && looksLikeChapterProseRest(rest)) return null
    if (rest) {
      // "Konu: Başlık" / "Bölüm 3 — Giriş" / "Konu 2"
      if (/^[:.\-–—\d]/.test(rest)) {
        rest = rest.replace(/^[:.\-–—]\s*/, '')
        if (!rest || looksLikeChapterProseRest(rest)) return null
        return {
          level: '#',
          title: `${capitalizeHeading(kw)} ${rest}`.trim(),
        }
      }
      // "Konu Özeti" gibi kısa başlık (cümle değil)
      if (rest.split(/\s+/).length <= 4 && rest.length <= 40) {
        return {
          level: '#',
          title: `${capitalizeHeading(kw)} ${rest}`.trim(),
        }
      }
      return null
    }
    return { level: '#', title: capitalizeHeading(kw) }
  }

  const numbered = t.match(/^(\d+(?:\.\d+){0,3})\.?\s+(.+)$/)
  if (numbered && numbered[2]!.length >= 3 && numbered[2]!.length <= 90) {
    // Cümle gibi numaralı satırları başlık sayma
    if (/[.!?…]$/.test(numbered[2]!) || numbered[2]!.split(/\s+/).length > 12) {
      return null
    }
    const depth = (numbered[1]!.match(/\./g) || []).length
    const level = depth === 0 ? '##' : '###'
    return {
      level,
      title: `${numbered[1]} ${capitalizeHeading(numbered[2]!)}`,
    }
  }

  const words = t.split(/\s+/).filter(Boolean)
  const upper = t === t.toLocaleUpperCase('tr-TR')
  if (
    upper &&
    t.length >= 4 &&
    t.length <= 80 &&
    /[A-ZÇĞİÖŞÜ]/.test(t) &&
    !/^\d+$/.test(t)
  ) {
    // Uzun ALL CAPS → ## ; kısa → ###
    const level = t.length <= 24 && words.length <= 3 ? '###' : '##'
    return { level, title: titleCaseTr(t) }
  }

  const capCount = words.filter((w) => /^[A-ZÇĞİÖŞÜÁÉÍÓÚ0-9]/.test(w)).length
  const capRatio = words.length ? capCount / words.length : 0

  // Kısa Title Case başlıklar (1–8 kelime)
  if (
    words.length >= 1 &&
    words.length <= 8 &&
    t.length <= 60 &&
    !/[.!?…:,;]$/.test(t) &&
    !/[,;]/.test(t) &&
    capRatio >= 0.55
  ) {
    // Tek kelime: en az 3 harf ve büyük harfle başlasın
    if (words.length === 1) {
      if (t.length >= 3 && /^[A-ZÇĞİÖŞÜ]/.test(t) && !/^\d+$/.test(t)) {
        return { level: '###', title: t }
      }
      return null
    }
    return { level: '###', title: t }
  }

  // Orta uzunluk Title Case
  if (
    words.length >= 2 &&
    words.length <= 12 &&
    t.length <= 75 &&
    !/[.!?…]$/.test(t) &&
    capRatio >= 0.7
  ) {
    return { level: '###', title: t }
  }

  return null
}

function asCallout(line: string): string | null {
  if (line.length < 12 || line.length > 280) return null

  if (/^(tanım|kavram|definition)\s*[:：]/i.test(line)) {
    return `> **Tanım:** ${emphasizeInline(line.replace(/^(tanım|kavram|definition)\s*[:：]\s*/i, ''))}`
  }
  if (/^(önemli|not|dikkat|uyarı|warning|note)\s*[:：]/i.test(line)) {
    const body = line.replace(/^(önemli|not|dikkat|uyarı|warning|note)\s*[:：]\s*/i, '')
    if (/^(dikkat|uyarı|warning)/i.test(line)) {
      return `> **Dikkat:** ${emphasizeInline(body)}`
    }
    return `> **Önemli:** ${emphasizeInline(body)}`
  }
  if (/^(örnek|example|benzetme|analoji)\s*[:：]/i.test(line)) {
    return `> **Örnek:** ${emphasizeInline(line.replace(/^(örnek|example|benzetme|analoji)\s*[:：]\s*/i, ''))}`
  }
  const def = line.match(/^([^:]{3,40})\s*:\s+(.{8,})$/)
  if (def && !/[.!?]$/.test(def[1]!) && def[1]!.split(/\s+/).length <= 6) {
    return `> **${def[1]!.trim()}:** ${emphasizeInline(def[2]!.trim())}`
  }
  return null
}

function emphasizeInline(text: string): string {
  return text
    .replace(/[“"]([^”"]{2,60})[”"]/g, '**$1**')
    .replace(
      /(?:^|[\s(])'([A-Za-zÇĞİÖŞÜçğıöşü][^']{1,40})'(?=[\s).,]|$)/g,
      (m, t) => m.replace(`'${t}'`, `**${t}**`),
    )
}

function capitalizeHeading(s: string): string {
  const t = repairTurkishText(s.trim())
  if (!t) return t
  if (/[çğıöşü]/i.test(t) && t !== t.toLocaleUpperCase('tr-TR')) {
    return t
  }
  if (t === t.toLocaleUpperCase('tr-TR') && t.length > 3) {
    return titleCaseTr(t)
  }
  return t.charAt(0).toLocaleUpperCase('tr-TR') + t.slice(1)
}

function titleCaseTr(s: string): string {
  return repairTurkishText(s)
    .toLocaleLowerCase('tr-TR')
    .split(/\s+/)
    .map((w) => {
      if (!w) return w
      if (/^(ve|ile|veya|veyâ|of|the|a|an|in|on|to)$/i.test(w)) return w
      return w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)
    })
    .join(' ')
}

function stripMdHeading(line: string): string {
  return String(line || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
}

function looksLikeBoxTitle(line: string): boolean {
  let t = String(line || '').trim()
  // ### Başlık da kutu başlığı say
  if (/^#{1,6}\s+\S/.test(t)) t = stripMdHeading(t)
  if (!t || t.length > 55 || /[.!?…]$/.test(t)) return false
  // Bölüm / numaralı başlıklar kutu değil
  if (
    /^(Bölüm|Chapter|Unit|Ünite|Konu|Kısım|Part|Section)\b/i.test(t)
  ) {
    return false
  }
  if (/^\d+(?:\.\d+){0,3}\.?\s+\S/.test(t)) return false
  if (/^\d+[.)]\s+\S/.test(t)) return false
  if (/^\|/.test(t) || /^<!--/.test(t) || /^>\s/.test(t)) return false
  if (/^[-*+•]\s/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 6) return false
  // Cümle gibi uzun bağlaçlı satırlar değil
  if (/,|;|:/.test(t) && words.length > 3) return false
  // Tamamen BÜYÜK ve 3+ kelime → genelde sayfa/bölüm başlığı
  if (
    words.length >= 3 &&
    t === t.toLocaleUpperCase('tr-TR') &&
    t.length > 28
  ) {
    return false
  }
  const cap = words.filter((w) => /^[A-ZÇĞİÖŞÜÁÉÍÓÚ]/.test(w)).length
  // Sayıyla başlayan kelimeleri başlık sayma (3.1 … hariç zaten elendi)
  return cap >= Math.max(1, Math.ceil(words.length * 0.5))
}

/** Karışmış satır-içi sütun gövdesini n parçaya böl. */
function splitInterleavedColumns(body: string, n: number): string[] | null {
  const t = body.replace(/\s+/g, ' ').trim()
  if (!t || n < 2) return null

  const cuts: number[] = []
  const re = /\s+(?=[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const idx = m.index
    if (idx >= 8 && idx <= t.length - 8) cuts.push(idx)
  }

  if (cuts.length >= n - 1) {
    let best: number[] | null = null
    let bestScore = Number.POSITIVE_INFINITY

    const pick = (start: number, left: number, chosen: number[]) => {
      if (left === 0) {
        const pts = [0, ...chosen, t.length]
        const lens: number[] = []
        for (let i = 0; i < n; i += 1) lens.push(pts[i + 1]! - pts[i]!)
        if (lens.some((l) => l < 8)) return
        const score = Math.max(...lens) - Math.min(...lens)
        if (score < bestScore) {
          bestScore = score
          best = [...chosen]
        }
        return
      }
      for (let i = start; i < cuts.length; i += 1) {
        pick(i + 1, left - 1, [...chosen, cuts[i]!])
      }
    }
    pick(0, n - 1, [])
    if (best) {
      const pts = [0, ...best, t.length]
      const parts: string[] = []
      for (let i = 0; i < n; i += 1) {
        parts.push(t.slice(pts[i], pts[i + 1]).trim())
      }
      if (parts.every((p) => p.length >= 6)) return parts
    }
  }

  // Yedek: yaklaşık eşit kelime dilimleri
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < n * 3) return null
  const size = Math.ceil(words.length / n)
  const parts: string[] = []
  for (let i = 0; i < n; i += 1) {
    parts.push(words.slice(i * size, (i + 1) * size).join(' '))
  }
  return parts.every(Boolean) ? parts : null
}

/**
 * PDF okuma sırası: önce 2–4 kutu başlığı alt alta, sonra karışık gövde.
 * → her başlığın hemen altına kendi gövdesi.
 */
function rebuildStackedConceptBoxes(raw: string): string {
  let text = rebuildAlternatingTitleBody(raw)
  text = rebuildStackedTitlesThenBodies(text)
  return text
}

/** Title / body / Title / body ardışık deseni. */
function rebuildAlternatingTitleBody(raw: string): string {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())

  const nonEmpty = lines
    .map((l, i) => ({ i, t: l }))
    .filter((x) => x.t)

  // En az 2 çift: title, body, title, body
  for (let s = 0; s + 3 < nonEmpty.length; s += 1) {
    const pairs: { title: string; body: string; start: number; end: number }[] = []
    let k = s
    while (k + 1 < nonEmpty.length) {
      const a = nonEmpty[k]!
      const b = nonEmpty[k + 1]!
      if (!looksLikeBoxTitle(a.t)) break
      // Gövde başlık gibi olmamalı; kısa cümle parçası da değil
      if (looksLikeBoxTitle(b.t)) break
      if (b.t.length < 18) break
      if (/^#{1,6}\s/.test(b.t)) break
      pairs.push({
        title: stripMdHeading(a.t),
        body: b.t,
        start: a.i,
        end: b.i,
      })
      k += 2
      if (pairs.length >= 4) break
    }
    if (pairs.length < 2) continue

    const first = pairs[0]!.start
    const last = pairs[pairs.length - 1]!.end
    const before = lines.slice(0, first)
    while (before.length && !before[before.length - 1]) before.pop()
    let afterIdx = last + 1
    while (afterIdx < lines.length && !lines[afterIdx]) afterIdx += 1
    const after = lines.slice(afterIdx)

    const sections: string[] = []
    for (const p of pairs) {
      sections.push(`### ${p.title}`)
      sections.push(p.body)
    }

    return [...before, sections.join('\n\n'), ...after]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }
  return raw
}

function rebuildStackedTitlesThenBodies(raw: string): string {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())

  const nonEmptyIdx = lines
    .map((l, i) => (l ? i : -1))
    .filter((i) => i >= 0)

  for (let s = 0; s < nonEmptyIdx.length; s += 1) {
    for (const n of [3, 4, 2]) {
      if (s + n > nonEmptyIdx.length) continue
      const titleIdxs = nonEmptyIdx.slice(s, s + n)
      const rawTitles = titleIdxs.map((i) => lines[i]!)
      if (!rawTitles.every(looksLikeBoxTitle)) continue
      const titles = rawTitles.map(stripMdHeading)
      const first = titleIdxs[0]!
      const last = titleIdxs[n - 1]!
      if (last - first > n + 3) continue

      const bodyStart = last + 1
      const bodyLines: string[] = []
      for (let j = bodyStart; j < lines.length; j += 1) {
        const t = lines[j]!
        if (!t) {
          if (bodyLines.length && j + 1 < lines.length && !lines[j + 1]) break
          continue
        }
        // Sonraki kutu grubu başladı
        if (
          looksLikeBoxTitle(t) &&
          j + 1 < lines.length &&
          looksLikeBoxTitle(lines[j + 1]!)
        ) {
          break
        }
        // Zaten ### başlık + gövde bölümü — dokunma
        if (/^#{1,6}\s/.test(t) && !looksLikeBoxTitle(t)) break
        if (/^\|.+\|/.test(t) || /^---+$/.test(t)) break
        bodyLines.push(t)
        if (bodyLines.join(' ').length > 1600) break
      }
      if (!bodyLines.length) continue

      let parts: string[] | null = null

      // 1) Tam n gövde satırı → 1:1 eşle
      if (
        bodyLines.length === n &&
        bodyLines.every((l) => l.length >= 10 && !looksLikeBoxTitle(l))
      ) {
        parts = bodyLines.map((l) => l.replace(/\s+/g, ' ').trim())
      }

      // 2) Boş satırlarla ayrılmış n paragraf
      if (!parts) {
        const paras = bodyLines
          .join('\n')
          .split(/\n{2,}/)
          .map((p) => p.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
        if (paras.length === n && paras.every((p) => p.length >= 10)) {
          parts = paras
        }
      }

      // 3) Karışık gövdeyi kes
      if (!parts) {
        const joined = bodyLines.join(' ').replace(/\s+/g, ' ').trim()
        if (joined.length < 20) continue
        parts = splitInterleavedColumns(joined, n)
      }
      if (!parts) continue

      const before = lines.slice(0, first)
      while (before.length && !before[before.length - 1]) before.pop()

      let afterIdx = bodyStart
      let taken = 0
      while (afterIdx < lines.length && taken < bodyLines.length) {
        if (lines[afterIdx]) taken += 1
        afterIdx += 1
      }
      while (afterIdx < lines.length && !lines[afterIdx]) afterIdx += 1
      const after = lines.slice(afterIdx)

      const sections: string[] = []
      for (let i = 0; i < n; i += 1) {
        sections.push(`### ${titles[i]}`)
        sections.push(parts[i]!)
      }

      return [...before, sections.join('\n\n'), ...after]
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
    }
  }
  return raw
}

function parsePipeRowCells(line: string): string[] | null {
  const t = String(line || '').trim()
  if (!/^\|.+\|/.test(t)) return null
  if (/^[\s|:-]+$/.test(t) && /-/.test(t)) return null
  let s = t
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => String(c ?? '').trim())
}

function isMdTableSep(line: string): boolean {
  const t = String(line || '').trim()
  return t.includes('|') && /^[\s|:-]+$/.test(t) && /-/.test(t)
}

/**
 * Eski <!-- study:boxes --> tablolarını dikey başlık + gövdeye çevir.
 * (Tüm başlıklar sonra tüm gövdeler karışmasın.)
 */
function convertBoxTablesToSections(md: string): string {
  const lines = String(md || '')
    .replace(/\r/g, '')
    .split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const isMark = /<!--\s*study:boxes\s*-->/.test(line.trim())
    const headerLine = isMark ? lines[i + 1] : line
    const headerIdx = isMark ? i + 1 : i
    const headers = parsePipeRowCells(headerLine ?? '')

    if (
      headers &&
      headers.length >= 2 &&
      lines[headerIdx + 1] &&
      isMdTableSep(lines[headerIdx + 1] ?? '')
    ) {
      // study:boxes işaretli VEYA kısa başlıklı 2 satırlık kutu tablosu
      const shortHeaders = headers.every(
        (h) => h.length > 0 && h.length <= 55 && !/[.!?…]$/.test(h),
      )
      if (!isMark && !shortHeaders) {
        out.push(line)
        i += 1
        continue
      }

      const bodyRows: string[][] = []
      let j = headerIdx + 2
      while (j < lines.length) {
        const cells = parsePipeRowCells(lines[j] ?? '')
        if (!cells || cells.length < 2) break
        bodyRows.push(cells)
        j += 1
      }

      const bodies = headers.map(() => '')
      for (const row of bodyRows) {
        row.forEach((text, ci) => {
          if (ci >= bodies.length || !text) return
          bodies[ci] = bodies[ci] ? `${bodies[ci]} ${text}` : text
        })
      }

      const sections: string[] = []
      headers.forEach((title, ci) => {
        const t = title.trim()
        const b = (bodies[ci] || '').replace(/\s+/g, ' ').trim()
        if (!t && !b) return
        if (t) sections.push(`### ${t}`)
        if (b) sections.push(b)
      })
      if (sections.length) {
        out.push(sections.join('\n\n'))
        i = j
        continue
      }
    }

    if (isMark) {
      i += 1
      continue
    }
    out.push(line)
    i += 1
  }

  return out.join('\n')
}

function fallbackParagraphs(raw: string): string {
  const cleaned = reflowSoftWraps(repairTurkishText(raw)).replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  const parts = cleaned
    .split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜÁÉÍÓÚ0-9“"«(])/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length <= 2) return emphasizeInline(cleaned)

  const paras: string[] = []
  let buf = ''
  for (const part of parts) {
    const next = buf ? `${buf} ${part}` : part
    if (next.length > 320 && buf) {
      paras.push(emphasizeInline(buf))
      buf = part
    } else {
      buf = next
    }
  }
  if (buf) paras.push(emphasizeInline(buf))
  return paras.join('\n\n')
}

export function pageHasReadableText(page: { text?: string } | undefined): boolean {
  return (page?.text?.replace(/\s+/g, '').length ?? 0) >= 40
}
