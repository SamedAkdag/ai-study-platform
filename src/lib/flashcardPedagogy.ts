/** Pedagogical arc for Studium flash Stories (learn → check → seal). */

export type FlashRole =
  | 'hook'
  | 'teach'
  | 'concept'
  | 'check'
  | 'trap'
  | 'summary'

export const FLASH_ROLE_ORDER: FlashRole[] = [
  'hook',
  'teach',
  'concept',
  'check',
  'trap',
  'summary',
]

export const FLASH_ROLE_META: Record<
  FlashRole,
  { label: string; phase: string; hint: string }
> = {
  hook: {
    label: 'Giriş',
    phase: 'Isın',
    hint: 'Neden önemli?',
  },
  teach: {
    label: 'Anlatım',
    phase: 'Öğren',
    hint: 'Kısa konu anlatımı',
  },
  concept: {
    label: 'Kavram',
    phase: 'Öğren',
    hint: 'Tanım / ezber',
  },
  check: {
    label: 'Soru',
    phase: 'Kontrol',
    hint: 'Kendini test et',
  },
  trap: {
    label: 'Tuzak',
    phase: 'Kontrol',
    hint: 'Sık yapılan hata',
  },
  summary: {
    label: 'Özet',
    phase: 'Pekiştir',
    hint: 'Tek cümlede kilit',
  },
}

const ROLE_ALIASES: Record<string, FlashRole> = {
  hook: 'hook',
  giris: 'hook',
  giriş: 'hook',
  isin: 'hook',
  ısın: 'hook',
  teach: 'teach',
  anlatim: 'teach',
  anlatım: 'teach',
  konu: 'teach',
  explain: 'teach',
  concept: 'concept',
  kavram: 'concept',
  tanim: 'concept',
  tanım: 'concept',
  ezber: 'concept',
  formul: 'concept',
  formül: 'concept',
  check: 'check',
  soru: 'check',
  quiz: 'check',
  kontrol: 'check',
  trap: 'trap',
  tuzak: 'trap',
  dikkat: 'trap',
  summary: 'summary',
  ozet: 'summary',
  özet: 'summary',
  pekistir: 'summary',
  pekiştir: 'summary',
}

export function normalizeFlashRole(
  raw: string | undefined | null,
): FlashRole | null {
  if (!raw) return null
  const key = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  const compact = key.replace(/\s+/g, '')
  return ROLE_ALIASES[key] || ROLE_ALIASES[compact] || null
}

export function flashRoleSortKey(role: FlashRole | null | undefined): number {
  if (!role) return 50
  const i = FLASH_ROLE_ORDER.indexOf(role)
  return i >= 0 ? i : 50
}
