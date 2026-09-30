// Token Harbor → Xiaomi MiMo (OpenAI-compatible)
// Official example: base https://tokenharbor.ai/v1 , model mimo-v2.6-flash:free
// Secrets: TOKENHARBOR_API_KEY (or TOKEN_HARBOR_API_KEY)

export type MimoMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const DEFAULT_BASE = 'https://tokenharbor.ai/v1'
const DEFAULT_MODEL = 'mimo-v2.6-flash:free'
const RETRIES = 3

export function getMimoConfig() {
  const apiKey =
    Deno.env.get('TOKENHARBOR_API_KEY') ||
    Deno.env.get('TOKEN_HARBOR_API_KEY')
  const baseURL = (
    Deno.env.get('TOKEN_HARBOR_BASE_URL') ||
    Deno.env.get('TOKENHARBOR_BASE_URL') ||
    DEFAULT_BASE
  ).replace(/\/$/, '')
  const model =
    Deno.env.get('MIMO_MODEL') ||
    Deno.env.get('TOKENHARBOR_MODEL') ||
    DEFAULT_MODEL
  return { apiKey, baseURL, model }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseRetryMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)\s*s/i)
  if (match) {
    return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 500, 20_000)
  }
  return 6_000
}

function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true
  return /rate_limit|quota|too many requests/i.test(body)
}

/** Pull assistant text from various OpenAI-compatible shapes. */
function extractMessageText(payload: unknown): {
  text: string
  finishReason: string | null
  detail: string
} {
  const p = payload as {
    choices?: Array<{
      finish_reason?: string
      message?: {
        content?: unknown
        refusal?: unknown
        reasoning?: unknown
        reasoning_content?: unknown
      }
      text?: unknown
    }>
    error?: { message?: string }
  }

  const choice = p?.choices?.[0]
  const finishReason = choice?.finish_reason ?? null
  const msg = choice?.message

  const candidates: unknown[] = [
    msg?.content,
    choice?.text,
    msg?.refusal,
  ]

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return { text: c.trim(), finishReason, detail: 'ok' }
    }
    // Some providers return content as [{type:'text', text:'...'}]
    if (Array.isArray(c)) {
      const joined = c
        .map((part) => {
          if (typeof part === 'string') return part
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: unknown }).text ?? '')
          }
          return ''
        })
        .join('')
        .trim()
      if (joined) return { text: joined, finishReason, detail: 'ok' }
    }
  }

  const snippet = JSON.stringify(payload).slice(0, 400)
  return {
    text: '',
    finishReason,
    detail: `empty content (finish_reason=${finishReason ?? 'null'}) payload=${snippet}`,
  }
}

export async function callMimo(
  messages: MimoMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const { apiKey, baseURL, model } = getMimoConfig()
  if (!apiKey) {
    throw new Error(
      'TOKENHARBOR_API_KEY (or TOKEN_HARBOR_API_KEY) is not set in Edge secrets',
    )
  }

  let lastErr = 'MiMo failed'
  let useJson = !!opts.json

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2500,
        ...(useJson ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
    })

    const body = await res.text()

    if (res.ok) {
      let payload: unknown
      try {
        payload = JSON.parse(body)
      } catch {
        lastErr = `MiMo returned non-JSON body: ${body.slice(0, 300)}`
        if (attempt < RETRIES) {
          await sleep(1200 * (attempt + 1))
          continue
        }
        throw new Error(lastErr)
      }

      const extracted = extractMessageText(payload)
      if (extracted.text) return extracted.text

      lastErr = `Empty MiMo response — ${extracted.detail}`
      // Free tier sometimes returns empty under load; retry
      if (attempt < RETRIES) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw new Error(lastErr)
    }

    if (
      useJson &&
      (res.status === 400 || res.status === 422) &&
      /response_format|json_object|unsupported|invalid/i.test(body)
    ) {
      console.warn('MiMo rejected response_format; retrying without JSON mode')
      useJson = false
      continue
    }

    lastErr = `MiMo error ${res.status}: ${body}`
    if (isRateLimited(res.status, body) && attempt < RETRIES) {
      await sleep(parseRetryMs(body))
      continue
    }

    if ((res.status === 500 || res.status === 503) && attempt < RETRIES) {
      await sleep(1500 * (attempt + 1))
      continue
    }

    const err = new Error(lastErr)
    if (isRateLimited(res.status, body)) {
      ;(err as Error & { code?: string }).code = 'RATE_LIMIT'
    }
    throw err
  }

  throw new Error(lastErr)
}
