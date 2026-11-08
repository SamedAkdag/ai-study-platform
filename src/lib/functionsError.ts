function formatTopicEdgePayload(parsed: {
  error?: unknown
  message?: unknown
  step?: unknown
  detail?: unknown
}): string | null {
  const errText =
    typeof parsed.error === 'string' && parsed.error.trim()
      ? parsed.error.trim()
      : parsed.error &&
          typeof parsed.error === 'object' &&
          parsed.error !== null &&
          'message' in parsed.error &&
          typeof (parsed.error as { message: unknown }).message === 'string'
        ? String((parsed.error as { message: string }).message)
        : typeof parsed.message === 'string' && parsed.message.trim()
          ? parsed.message.trim()
          : null
  if (!errText) return null
  const step =
    typeof parsed.step === 'string' && parsed.step.trim()
      ? parsed.step.trim()
      : ''
  const detail =
    typeof parsed.detail === 'string' && parsed.detail.trim()
      ? parsed.detail.trim()
      : ''
  return [step ? `[${step}]` : '', errText, detail ? `Detail: ${detail}` : '']
    .filter(Boolean)
    .join(' ')
}

/** Pull a readable message from supabase.functions.invoke failures. */
export async function extractFunctionsError(
  error: unknown,
  data?: unknown,
): Promise<string> {
  if (data && typeof data === 'object' && data !== null) {
    const formatted = formatTopicEdgePayload(
      data as {
        error?: unknown
        message?: unknown
        step?: unknown
        detail?: unknown
      },
    )
    if (formatted) return formatted
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
        step?: unknown
        detail?: unknown
      }
      const formatted = formatTopicEdgePayload(parsed)
      if (formatted) return formatted
    } catch {
      /* not JSON */
    }

    if (raw.length < 800) return raw
    return `${base} (${raw.slice(0, 400)}…)`
  } catch {
    return base
  }
}
