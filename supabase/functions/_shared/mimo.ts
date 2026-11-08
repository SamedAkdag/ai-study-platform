// Requesty router (OpenAI-compatible Chat Completions)
// Docs: https://router.requesty.ai/v1  ·  model novita/ling-3.1-flash
// Secrets: REQUESTY_API_KEY (AI_GATEWAY_* / TOKENHARBOR_* still accepted)

/** OpenAI-style text or multimodal content parts (image_url + text). */
export type MimoContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type MimoMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | MimoContentPart[]
}

const DEFAULT_BASE = 'https://router.requesty.ai/v1'
const DEFAULT_MODEL = 'novita/ling-3.1-flash'
/** Ling hybrid reasoning burns max_tokens before content — keep retries low. */
const RETRIES = 1

export function getMimoConfig() {
  const apiKey =
    Deno.env.get('REQUESTY_API_KEY') ||
    Deno.env.get('AI_GATEWAY_API_KEY') ||
    Deno.env.get('TOKENHARBOR_API_KEY') ||
    Deno.env.get('TOKEN_HARBOR_API_KEY')
  const baseURL = (
    Deno.env.get('REQUESTY_BASE_URL') ||
    Deno.env.get('AI_GATEWAY_BASE_URL') ||
    Deno.env.get('TOKEN_HARBOR_BASE_URL') ||
    Deno.env.get('TOKENHARBOR_BASE_URL') ||
    DEFAULT_BASE
  ).replace(/\/$/, '')
  const model =
    Deno.env.get('REQUESTY_MODEL') ||
    Deno.env.get('AI_GATEWAY_MODEL') ||
    Deno.env.get('MIMO_MODEL') ||
    Deno.env.get('TOKENHARBOR_MODEL') ||
    DEFAULT_MODEL
  /**
   * Requesty: reasoning_effort none|min disables / minimizes chain-of-thought.
   * Ling defaults to thinking ON; without this, max_tokens often fills with
   * reasoning_content and visible content stays empty → slow retries.
   */
  const reasoningEffort = (
    Deno.env.get('REQUESTY_REASONING_EFFORT') ||
    Deno.env.get('AI_REASONING_EFFORT') ||
    'none'
  ).trim()
  return { apiKey, baseURL, model, reasoningEffort }
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

export type TokenUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** MiMo / OpenAI-style prefix KV cache hits (prompt_tokens_details.cached_tokens). */
  cached_tokens: number
  /** True when API omitted usage and we estimated from char length. */
  estimated: boolean
}

export type MimoResult = {
  text: string
  usage: TokenUsage
}

function contentCharLength(content: MimoMessage['content']): number {
  if (typeof content === 'string') return content.length
  return content.reduce((n, part) => {
    if (part.type === 'text') return n + part.text.length
    return n + 80 // rough image_url overhead
  }, 0)
}

export function estimateTokenUsage(
  messages: MimoMessage[],
  outputText: string,
): TokenUsage {
  const inputChars = messages.reduce(
    (n, m) => n + contentCharLength(m.content),
    0,
  )
  const prompt_tokens = Math.max(1, Math.ceil(inputChars / 4))
  const completion_tokens = Math.max(0, Math.ceil(String(outputText).length / 4))
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
    cached_tokens: 0,
    estimated: true,
  }
}

function readCachedTokens(u: Record<string, unknown>): number {
  const direct = Number(
    u.cached_tokens ?? u.cache_read_tokens ?? u.cache_read_input_tokens ?? 0,
  )
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct)

  const details = u.prompt_tokens_details
  if (details && typeof details === 'object') {
    const d = details as Record<string, unknown>
    const n = Number(d.cached_tokens ?? d.cache_read_tokens ?? 0)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }

  const inputDetails = u.input_tokens_details
  if (inputDetails && typeof inputDetails === 'object') {
    const d = inputDetails as Record<string, unknown>
    const n = Number(d.cached_tokens ?? 0)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }

  return 0
}

export function extractTokenUsage(
  payload: unknown,
  fallback: TokenUsage,
): TokenUsage {
  const u = (payload as { usage?: Record<string, unknown> } | null)?.usage
  if (!u || typeof u !== 'object') return fallback

  const prompt = Number(
    u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0,
  )
  const completion = Number(
    u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0,
  )
  const total = Number(u.total_tokens ?? u.totalTokens ?? 0)
  const cached_tokens = Math.min(
    Math.max(0, readCachedTokens(u)),
    Math.max(0, Math.round(prompt) || 0) || Number.POSITIVE_INFINITY,
  )

  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return fallback
  const prompt_tokens = Math.max(0, Math.round(prompt) || 0)
  const completion_tokens = Math.max(0, Math.round(completion) || 0)
  const total_tokens =
    Math.max(0, Math.round(total) || 0) || prompt_tokens + completion_tokens

  if (prompt_tokens === 0 && completion_tokens === 0 && total_tokens === 0) {
    return fallback
  }

  return {
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cached_tokens: Number.isFinite(cached_tokens)
      ? Math.min(cached_tokens, prompt_tokens)
      : 0,
    estimated: false,
  }
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
): Promise<MimoResult> {
  const { apiKey, baseURL, model, reasoningEffort } = getMimoConfig()
  if (!apiKey) {
    throw new Error(
      'REQUESTY_API_KEY is not set in Edge secrets (AI_GATEWAY_* / TOKENHARBOR_* also accepted)',
    )
  }

  let lastErr = 'AI request failed'
  let useJson = !!opts.json
  // First attempt uses caller budget; if thinking ate it, one bump retry.
  let maxTokens = opts.maxTokens ?? 2500
  // Novita Ling via Requesty often 400s on response_format / enable_thinking.
  let stripThinkingFlags = false

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const payloadBody: Record<string, unknown> = {
      model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: maxTokens,
      messages,
    }
    if (!stripThinkingFlags && reasoningEffort) {
      payloadBody.reasoning_effort = reasoningEffort
      if (reasoningEffort === 'none' || reasoningEffort === 'min') {
        payloadBody.enable_thinking = false
      }
    }
    if (useJson) {
      payloadBody.response_format = { type: 'json_object' }
    }

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloadBody),
    })

    const body = await res.text()

    if (res.ok) {
      let payload: unknown
      try {
        payload = JSON.parse(body)
      } catch {
        lastErr = `AI returned non-JSON body: ${body.slice(0, 300)}`
        if (attempt < RETRIES) {
          await sleep(400 * (attempt + 1))
          continue
        }
        throw new Error(lastErr)
      }

      const extracted = extractMessageText(payload)
      if (extracted.text) {
        const fallback = estimateTokenUsage(messages, extracted.text)
        return {
          text: extracted.text,
          usage: extractTokenUsage(payload, fallback),
        }
      }

      lastErr = `Empty AI response — ${extracted.detail}`
      // length + empty usually means reasoning filled the budget
      if (
        attempt < RETRIES &&
        (extracted.finishReason === 'length' || /empty content/i.test(extracted.detail))
      ) {
        maxTokens = Math.min(Math.max(maxTokens * 2, maxTokens + 800), 6000)
        await sleep(200)
        continue
      }
      throw new Error(lastErr)
    }

    // Ling/Novita often returns opaque {"origin":"provider","message":"Bad Request"}
    // for response_format json_object — same path PDF notes recover via llmCompleteJson.
    if (useJson && (res.status === 400 || res.status === 422)) {
      console.warn(
        'Provider rejected JSON mode (or thinking flags); retrying plain chat',
      )
      useJson = false
      stripThinkingFlags = true
      continue
    }

    lastErr = `AI error ${res.status}: ${body}`
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
