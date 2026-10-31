export type MoodThemeId = 'forest' | 'blush' | 'night' | 'ink'

export type MoodTheme = {
  id: MoodThemeId
  label: string
  swatch: string
}

export const MOOD_THEMES: MoodTheme[] = [
  { id: 'forest', label: 'Orman', swatch: '#2d4635' },
  { id: 'blush', label: 'Gül', swatch: '#9a5b6a' },
  { id: 'ink', label: 'Mürekkep', swatch: '#2c3a4a' },
  { id: 'night', label: 'Gece', swatch: '#1a2330' },
]

const KEY = 'studium_mood_theme_v1'

export function readMoodTheme(): MoodThemeId {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'blush' || raw === 'night' || raw === 'ink' || raw === 'forest') {
      return raw
    }
  } catch {
    /* ignore */
  }
  return 'forest'
}

export function applyMoodTheme(id: MoodThemeId) {
  const root = document.documentElement
  if (id === 'forest') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', id)
  }
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
}

/** Call once on app boot. */
export function initMoodTheme() {
  applyMoodTheme(readMoodTheme())
}

export type RgbTuple = [number, number, number]

/** Hex / rgb CSS colors for PDF + print exports matching the active mood. */
export type ExportPalette = {
  themeId: MoodThemeId
  paper: string
  surface: string
  ink: string
  inkMuted: string
  inkSoft: string
  accent: string
  accentDeep: string
  accentMid: string
  accentSoft: string
  gold: string
  paperRgb: RgbTuple
  surfaceRgb: RgbTuple
  inkRgb: RgbTuple
  inkMutedRgb: RgbTuple
  accentRgb: RgbTuple
  accentDeepRgb: RgbTuple
  accentMidRgb: RgbTuple
  accentSoftRgb: RgbTuple
  goldRgb: RgbTuple
}

function parseCssColor(raw: string): RgbTuple | null {
  const s = (raw || '').trim()
  if (!s) return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('')
    }
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ]
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s)
  if (m) {
    return [
      Math.min(255, Number(m[1])) / 255,
      Math.min(255, Number(m[2])) / 255,
      Math.min(255, Number(m[3])) / 255,
    ]
  }
  return null
}

function toHex([r, g, b]: RgbTuple): string {
  const h = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function mix(a: RgbTuple, b: RgbTuple, t: number): RgbTuple {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

const FALLBACK: ExportPalette = {
  themeId: 'forest',
  paper: '#f4f3ee',
  surface: '#ffffff',
  ink: '#1a2b24',
  inkMuted: '#5a6b63',
  inkSoft: '#84948c',
  accent: '#2d4635',
  accentDeep: '#243a2c',
  accentMid: '#3d5c48',
  accentSoft: '#e6efea',
  gold: '#a67c52',
  paperRgb: [0.957, 0.953, 0.933],
  surfaceRgb: [1, 1, 1],
  inkRgb: [0.102, 0.169, 0.141],
  inkMutedRgb: [0.353, 0.42, 0.388],
  accentRgb: [0.176, 0.275, 0.208],
  accentDeepRgb: [0.141, 0.227, 0.173],
  accentMidRgb: [0.239, 0.361, 0.282],
  accentSoftRgb: [0.902, 0.937, 0.918],
  goldRgb: [0.651, 0.486, 0.322],
}

/**
 * Snapshot the live CSS mood tokens for PDF / print export.
 * Falls back to forest if styles are unavailable (SSR / tests).
 */
export function getExportPalette(): ExportPalette {
  if (typeof document === 'undefined') return FALLBACK
  const themeId = readMoodTheme()
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string, fb: RgbTuple): RgbTuple =>
    parseCssColor(cs.getPropertyValue(name)) ?? fb

  const inkRgb = read('--ink', FALLBACK.inkRgb)
  const inkMutedRgb = read('--ink-muted', FALLBACK.inkMutedRgb)
  const inkSoftRgb = read('--ink-soft', [0.518, 0.58, 0.549])
  const accentRgb = read('--accent', FALLBACK.accentRgb)
  const accentDeepRgb = read('--accent-deep', FALLBACK.accentDeepRgb)
  const accentMidRgb = read('--accent-mid', FALLBACK.accentMidRgb)
  const accentSoftRgb = read('--accent-soft', FALLBACK.accentSoftRgb)
  const goldRgb = read('--gold', FALLBACK.goldRgb)
  const paperRgb = read('--paper', FALLBACK.paperRgb)
  const surfaceRgb = read('--surface-solid', FALLBACK.surfaceRgb)

  // Night: keep dark page so export matches the UI tone.
  // Light themes: prefer near-white surface for crisp print, tinted paper wash.
  const isNight = themeId === 'night'
  const exportPaper = isNight ? paperRgb : mix(paperRgb, [1, 1, 1], 0.55)
  const exportSurface = isNight ? surfaceRgb : [1, 1, 1] as RgbTuple
  const exportSoft = isNight
    ? accentSoftRgb
    : mix(accentSoftRgb, [1, 1, 1], 0.15)

  return {
    themeId,
    paper: toHex(exportPaper),
    surface: toHex(exportSurface),
    ink: toHex(inkRgb),
    inkMuted: toHex(inkMutedRgb),
    inkSoft: toHex(inkSoftRgb),
    accent: toHex(accentRgb),
    accentDeep: toHex(accentDeepRgb),
    accentMid: toHex(accentMidRgb),
    accentSoft: toHex(exportSoft),
    gold: toHex(goldRgb),
    paperRgb: exportPaper,
    surfaceRgb: exportSurface,
    inkRgb,
    inkMutedRgb,
    accentRgb,
    accentDeepRgb,
    accentMidRgb,
    accentSoftRgb: exportSoft,
    goldRgb,
  }
}
