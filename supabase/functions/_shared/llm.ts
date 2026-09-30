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
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export function safeParseJson(raw: string): unknown {
  const cleaned = stripMarkdownJson(raw)
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const slice = cleaned.slice(start, end + 1)
      try {
        return JSON.parse(slice)
      } catch {
        return JSON.parse(repairTruncatedJson(slice))
      }
    }
    throw new Error('AI response was not valid JSON')
  }
}

function repairTruncatedJson(input: string): string {
  let s = input
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\r/g, '')

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
