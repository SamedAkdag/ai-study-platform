// Shared LLM helper: Groq first, Gemini fallback on rate limits / outages.
// Secrets: GROQ_API_KEY, GEMINI_API_KEY

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'qwen/qwen3.8-27b'
const GROQ_RETRIES = 2

// Prefer stabler Flash variants; "latest" often 503 under load
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-flash-latest',
]

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmResult = {
  text: string
  provider: 'groq' | 'gemini'
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

        // Unknown model → try next model immediately
        if (status === 404 || /not found|is not found/i.test(body)) {
          console.warn(`Gemini model unavailable: ${model}`)
          break
        }

        if (isTransientGemini(status, body) && attempt < 2) {
          await sleep(1500 * (attempt + 1))
          continue
        }

        // Transient on last attempt → try next model
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

/** Prefer Groq; on daily/minute rate limits fall back to Gemini. */
export async function llmComplete(opts: {
  messages: ChatMessage[]
  json?: boolean
  temperature?: number
  maxTokens?: number
}): Promise<LlmResult> {
  const groqKey = Deno.env.get('GROQ_API_KEY')
  const geminiKey = Deno.env.get('GEMINI_API_KEY')

  if (!groqKey && !geminiKey) {
    throw new Error('Neither GROQ_API_KEY nor GEMINI_API_KEY is set')
  }

  if (groqKey) {
    try {
      const text = await callGroq(groqKey, opts.messages, opts)
      return { text, provider: 'groq' }
    } catch (err) {
      const code = (err as { code?: string }).code
      const msg = err instanceof Error ? err.message : String(err)
      const shouldFallback =
        code === 'RATE_LIMIT' || isRateLimited(429, msg) || /429/.test(msg)

      if (!shouldFallback || !geminiKey) throw err
      console.warn('Groq rate-limited/unavailable, falling back to Gemini')
    }
  }

  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')
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
    // Try extracting outermost object
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

/** Best-effort close of truncated JSON strings/arrays/objects. */
function repairTruncatedJson(input: string): string {
  let s = input
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .replace(/\r/g, '')

  // If we're inside an open string, close it
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

  // Close open brackets
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
