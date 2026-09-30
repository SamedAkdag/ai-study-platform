/** Pull a readable message from supabase.functions.invoke failures. */
export async function extractFunctionsError(
  error: unknown,
  data?: unknown,
): Promise<string> {
  if (data && typeof data === 'object' && data !== null && 'error' in data) {
    const e = (data as { error: unknown }).error
    if (typeof e === 'string' && e.trim()) return e
  }

  if (!(error instanceof Error)) {
    return typeof error === 'string' ? error : 'Edge Function failed'
  }

  const base = error.message || 'Edge Function failed'
  const ctx = (error as { context?: Response }).context
  if (!ctx || typeof ctx.text !== 'function') return base

  try {
    const raw = await ctx.clone().text()
    if (!raw.trim()) return base

    try {
      const parsed = JSON.parse(raw) as {
        error?: unknown
        message?: unknown
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error
      }
      if (
        parsed.error &&
        typeof parsed.error === 'object' &&
        parsed.error !== null &&
        'message' in parsed.error &&
        typeof (parsed.error as { message: unknown }).message === 'string'
      ) {
        return (parsed.error as { message: string }).message
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message
      }
    } catch {
      /* not JSON */
    }

    if (raw.length < 800) return raw
    return `${base} (${raw.slice(0, 400)}…)`
  } catch {
    return base
  }
}
