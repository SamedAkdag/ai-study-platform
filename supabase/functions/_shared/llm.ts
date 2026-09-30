// Shared LLM: MiMo (Token Harbor) → Groq → Gemini
// Secrets: TOKEN_HARBOR_API_KEY, GROQ_API_KEY?, GEMINI_API_KEY?

import { callMimo, getMimoConfig } from './mimo.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'qwen/qwen3.8-27b'
const GROQ_RETRIES = 2

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
]

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmResult = {
  text: string
  provider: 'mimo' | 'groq' | 'gemini'
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseRetryMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)\s*s/i)
  if (match) return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 500, 20_000)
  return 8_000
}

function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true
  return /rate_limit|quota|resource.?exhausted|tokens per day/i.test(body)
}

function isTransientGemini(status: number, body: string): boolean {
  if (status === 503 || status === 500 || status === 429) return true
  return /UNAVAILABLE|high demand|try again later|overloaded/i.test(body)
}

async function callGroq(
  apiKey: string,
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number },
): Promise<string> {
  let lastErr = 'Groq failed'

  for (let attempt = 0; attempt <= GROQ_RETRIES; attempt += 1) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: opts.temperature ?? 0.3,
        reasoning_effort: 'none',
        max_tokens: opts.maxTokens ?? 2000,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
    })

    const body = await res.text()
    if (res.ok) {
      const payload = JSON.parse(body)
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('Empty Groq response')
      return content
    }

    lastErr = `Groq error ${res.status}: ${body}`
    if (isRateLimited(res.status, body)) {
      if (attempt < GROQ_RETRIES) {
        await sleep(parseRetryMs(body))
        continue
      }
      const err = new Error(lastErr)
      ;(err as Error & { code?: string }).code = 'RATE_LIMIT'
      throw err
    }
    throw new Error(lastErr)
  }

  throw new Error(lastErr)
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number },
): Promise<string> {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const normalized: typeof contents = []
  for (const c of contents) {
    const last = normalized[normalized.length - 1]
    if (last && last.role === c.role) {
      last.parts[0]!.text += `\n\n${c.parts[0]!.text}`
    } else {
      normalized.push(c)
    }
  }

  if (normalized.length === 0 || normalized[0]!.role !== 'user') {
    normalized.unshift({
      role: 'user',
      parts: [{ text: 'Continue.' }],
    })
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      ...(system
        ? { systemInstruction: { parts: [{ text: system }] } }
        : {}),
      contents: normalized,
      generationConfig: {
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxTokens ?? 2000,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  })

  const body = await res.text()
  if (!res.ok) {
    const err = new Error(`Gemini error ${res.status} (${model}): ${body}`)
    ;(err as Error & { status?: number; body?: string }).status = res.status
    ;(err as Error & { status?: number; body?: string }).body = body
    throw err
  }

  const payload = JSON.parse(body)
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text || '')
    .join('')

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`Empty Gemini response (${model})`)
  }
  return text
}

async function callGemini(
  apiKey: string,
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number },
): Promise<string> {
  let lastErr: Error = new Error('Gemini failed')

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await callGeminiOnce(apiKey, model, messages, opts)
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        const status = (err as { status?: number }).status ?? 0
        const body = (err as { body?: string }).body ?? lastErr.message

        if (status === 404 || /not found|is not found/i.test(body)) {
          console.warn(`Gemini model unavailable: ${model}`)
          break
        }

        if (isTransientGemini(status, body) && attempt < 2) {
          await sleep(1500 * (attempt + 1))
          continue
        }

        if (isTransientGemini(status, body)) {
          console.warn(`Gemini ${model} overloaded, trying next model`)
          break
        }

        throw lastErr
      }
    }
  }

  throw lastErr
}

function shouldFallback(err: unknown): boolean {
  const code = (err as { code?: string }).code
  const msg = err instanceof Error ? err.message : String(err)
  return (
    code === 'RATE_LIMIT' ||
    isRateLimited(429, msg) ||
    /429|503|rate.?limit|unavailable|overloaded/i.test(msg)
  )
}

function fallbackAllowed(): boolean {
  const flag = (Deno.env.get('ALLOW_LLM_FALLBACK') || '').toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

/**
 * Primary: Xiaomi MiMo via Token Harbor.
 * Groq/Gemini only if ALLOW_LLM_FALLBACK=true (and their keys exist).
 */
export async function llmComplete(opts: {
  messages: ChatMessage[]
  json?: boolean
  temperature?: number
  maxTokens?: number
}): Promise<LlmResult> {
  const { apiKey: mimoKey, model: mimoModel, baseURL } = getMimoConfig()
  const groqKey = Deno.env.get('GROQ_API_KEY')
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const allowFallback = fallbackAllowed()

  if (!mimoKey) {
    throw new Error(
      'TOKENHARBOR_API_KEY is not set in Supabase Edge secrets. ' +
        'Add it (Dashboard → Edge Functions → Secrets), then redeploy functions. ' +
        'Official: base https://tokenharbor.ai/v1 , model mimo-v2.6-flash:free. ' +
        'MiMo is required; Gemini/Groq are not used unless ALLOW_LLM_FALLBACK=true.',
    )
  }

  try {
    const text = await callMimo(opts.messages, opts)
    return { text, provider: 'mimo' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (!allowFallback) {
      throw new Error(
        `MiMo failed (${mimoModel} @ ${baseURL}): ${msg}. ` +
          'No fallback (set ALLOW_LLM_FALLBACK=true only if you want Groq/Gemini).',
      )
    }

    if (!shouldFallback(err)) throw err
    console.warn('MiMo failed; ALLOW_LLM_FALLBACK=true → trying Groq/Gemini', msg)
  }

  if (groqKey) {
    try {
      const text = await callGroq(groqKey, opts.messages, opts)
      return { text, provider: 'groq' }
    } catch (err) {
      if (!shouldFallback(err) || !geminiKey) throw err
      console.warn('Groq unavailable, falling back to Gemini')
    }
  }

  if (!geminiKey) {
    throw new Error('MiMo failed and no GROQ_API_KEY / GEMINI_API_KEY for fallback')
  }
  const text = await callGemini(geminiKey, opts.messages, opts)
  return { text, provider: 'gemini' }
}

export function stripMarkdownJson(raw: string): string {
  let trimmed = raw.trim()
  // Prefer fenced block anywhere in the reply
  const fencedAnywhere = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedAnywhere?.[1]) trimmed = fencedAnywhere[1].trim()
  else {
    trimmed = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
  }
  return trimmed
}

/** Best-effort JSON parse for flaky LLM output (truncation, fences, bad escapes). */
export function safeParseJson(raw: string): unknown {
  const cleaned = stripMarkdownJson(raw)
  const attempts = [
    cleaned,
    extractBalancedObject(cleaned),
    repairTruncatedJson(extractBalancedObject(cleaned) || cleaned),
    repairCommonJsonIssues(cleaned),
    repairTruncatedJson(repairCommonJsonIssues(cleaned)),
  ].filter((s): s is string => !!s && s.trim().length > 0)

  let lastErr: unknown
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate)
    } catch (err) {
      lastErr = err
    }
  }

  const detail =
    lastErr instanceof Error ? lastErr.message : 'parse failed'
  throw new Error(
    `AI response was not valid JSON (${detail}). Snippet: ${cleaned.slice(0, 180)}`,
  )
}

function extractBalancedObject(input: string): string | null {
  const start = input.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return input.slice(start, i + 1)
    }
  }
  // Truncated: take from first { to end for repairTruncatedJson
  return input.slice(start)
}

function repairCommonJsonIssues(input: string): string {
  let s = input
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/,\s*([}\]])/g, '$1')

  // Smart quotes → plain
  s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019]/g, "'")

  // Trailing commas again after other fixes
  s = s.replace(/,\s*([}\]])/g, '$1')
  return s
}

function repairTruncatedJson(input: string): string {
  let s = repairCommonJsonIssues(input).replace(/\r/g, '')

  // Escape raw newlines / tabs inside strings (common LLM mistake)
  {
    let out = ''
    let inString = false
    let escape = false
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i]!
      if (escape) {
        out += ch
        escape = false
        continue
      }
      if (ch === '\\' && inString) {
        out += ch
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        out += ch
        continue
      }
      if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
        out += ch === '\t' ? '\\t' : '\\n'
        continue
      }
      out += ch
    }
    s = out
  }

  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') inString = !inString
  }
  if (inString) s += '"'

  const stack: string[] = []
  inString = false
  escape = false
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    if (ch === '}' || ch === ']') stack.pop()
  }
  while (stack.length) {
    const open = stack.pop()
    s += open === '{' ? '}' : ']'
  }

  s = s.replace(/,\s*([}\]])/g, '$1')
  return s
}

/**
 * Ask the LLM for JSON with retries + repair pass.
 * Survives intermittent free-tier junk / truncated objects.
 */
export async function llmCompleteJson(opts: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  retries?: number
}): Promise<{ value: Record<string, unknown>; provider: LlmResult['provider'] }> {
  const retries = opts.retries ?? 2
  let lastErr: Error = new Error('AI response was not valid JSON')

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const useJson = attempt < retries
    try {
      const { text, provider } = await llmComplete({
        messages: opts.messages,
        json: useJson,
        temperature: attempt === 0 ? (opts.temperature ?? 0.3) : 0.15,
        maxTokens: opts.maxTokens,
      })
      try {
        const value = safeParseJson(text) as Record<string, unknown>
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return { value, provider }
        }
        throw new Error('JSON root was not an object')
      } catch (parseErr) {
        lastErr = parseErr instanceof Error ? parseErr : new Error(String(parseErr))
        // One repair call before next full regenerate
        const { text: repaired } = await llmComplete({
          messages: [
            {
              role: 'system',
              content:
                'Return ONLY valid compact JSON. Escape newlines as \\n inside strings. No markdown fences. Do not truncate.',
            },
            {
              role: 'user',
              content: `Fix into valid JSON object:\n${text.slice(0, 12000)}`,
            },
          ],
          json: true,
          temperature: 0,
          maxTokens: Math.min(opts.maxTokens ?? 3000, 3500),
        })
        const value = safeParseJson(repaired) as Record<string, unknown>
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return { value, provider }
        }
        throw new Error('Repaired JSON root was not an object')
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt < retries) {
        await sleep(800 * (attempt + 1))
        continue
      }
    }
  }

  throw lastErr
}
