/** User choice: segment whole book vs a page range. */

export type UnitScope =
  | { mode: 'all' }
  | { mode: 'range'; from: number; to: number }

const PREFIX = 'studium.unitScope.v1:'

export function stashUnitScope(bookId: string, scope: UnitScope) {
  try {
    sessionStorage.setItem(PREFIX + bookId, JSON.stringify(scope))
  } catch {
    /* ignore */
  }
}

export function takeUnitScope(bookId: string): UnitScope | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + bookId)
    sessionStorage.removeItem(PREFIX + bookId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UnitScope
    if (parsed?.mode === 'all') return { mode: 'all' }
    if (
      parsed?.mode === 'range' &&
      Number.isFinite(parsed.from) &&
      Number.isFinite(parsed.to)
    ) {
      return {
        mode: 'range',
        from: Math.max(1, Math.round(parsed.from)),
        to: Math.max(1, Math.round(parsed.to)),
      }
    }
    return null
  } catch {
    return null
  }
}

export function peekUnitScope(bookId: string): UnitScope | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + bookId)
    if (!raw) return null
    return JSON.parse(raw) as UnitScope
  } catch {
    return null
  }
}

export function normalizeUnitScope(
  scope: UnitScope | null | undefined,
  maxPage: number,
): { from: number; to: number } | null {
  if (!scope || scope.mode === 'all') return null
  const max = Math.max(1, maxPage || 1)
  let from = Math.min(max, Math.max(1, scope.from))
  let to = Math.min(max, Math.max(1, scope.to))
  if (from > to) [from, to] = [to, from]
  return { from, to }
}

export function describeUnitScope(
  scope: UnitScope | null | undefined,
  maxPage?: number,
): string {
  if (!scope || scope.mode === 'all') {
    return maxPage && maxPage > 0
      ? `Tüm kitap (1–${maxPage})`
      : 'Tüm kitap'
  }
  return `Sayfa ${scope.from}–${scope.to}`
}
