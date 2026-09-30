/** Normalize Supabase / unknown failures into Error with a readable message. */
export function asError(err: unknown, fallback = 'İşlem başarısız'): Error {
  if (err instanceof Error) return err
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown; details?: unknown; code?: unknown }
    const parts = [o.message, o.details, o.code].filter(
      (p) => typeof p === 'string' && p.trim(),
    ) as string[]
    if (parts.length) return new Error(parts.join(' — '))
    if (typeof o.error === 'string' && o.error.trim()) return new Error(o.error)
  }
  if (typeof err === 'string' && err.trim()) return new Error(err)
  return new Error(fallback)
}

export function throwAsError(err: unknown, fallback?: string): never {
  throw asError(err, fallback)
}
