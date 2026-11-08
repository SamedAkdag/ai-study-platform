/**
 * Supabase EdgeRuntime.waitUntil — keep isolate alive after HTTP response
 * so we can kick the next short section job (fresh wall-clock per invoke).
 * Does NOT raise CPU/memory limits; only schedules follow-up work.
 */

type EdgeRuntimeLike = {
  waitUntil: (promise: Promise<unknown>) => void
}

function getEdgeRuntime(): EdgeRuntimeLike | null {
  const g = globalThis as unknown as { EdgeRuntime?: EdgeRuntimeLike }
  return g.EdgeRuntime ?? null
}

/** Fire-and-forget; uses waitUntil when available. */
export function runAfterResponse(work: Promise<unknown>): void {
  const rt = getEdgeRuntime()
  if (rt?.waitUntil) {
    rt.waitUntil(
      work.catch((err) => {
        console.error('waitUntil task failed', err)
      }),
    )
    return
  }
  // Local/CLI without EdgeRuntime
  void work.catch((err) => console.error('background task failed', err))
}

/** Chain: POST next Edge invoke after current response (new isolate budget). */
export function kickEdgeFunction(opts: {
  functionName: string
  body: Record<string, unknown>
}): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.warn('kickEdgeFunction: missing SUPABASE_URL / SERVICE_ROLE')
    return
  }
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${opts.functionName}`
  runAfterResponse(
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(opts.body),
    }).then(async (res) => {
      if (!res.ok) {
        const t = await res.text()
        console.error('kickEdgeFunction non-OK', res.status, t.slice(0, 300))
      }
    }),
  )
}
