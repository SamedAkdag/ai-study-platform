/**
 * Token Harbor official example:
 *   base_url = https://tokenharbor.ai/v1
 *   model    = mimo-v2.6-flash:free
 *   env      = TOKENHARBOR_API_KEY
 *
 * App calls go through Supabase Edge (`_shared/mimo.ts`).
 */
import OpenAI from 'openai'

const baseURL = (
  process.env.TOKEN_HARBOR_BASE_URL ||
  process.env.TOKENHARBOR_BASE_URL ||
  'https://tokenharbor.ai/v1'
).replace(/\/$/, '')

export const mimoClient = new OpenAI({
  apiKey:
    process.env.TOKENHARBOR_API_KEY || process.env.TOKEN_HARBOR_API_KEY,
  baseURL,
})

export const MIMO_MODEL =
  process.env.MIMO_MODEL ||
  process.env.TOKENHARBOR_MODEL ||
  'mimo-v2.6-flash:free'

export async function mimoChat(opts: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  json?: boolean
}) {
  const completion = await mimoClient.chat.completions.create({
    model: MIMO_MODEL,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1024,
    ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
  })
  const text = completion.choices[0]?.message?.content
  if (!text) throw new Error('Empty MiMo response')
  return text
}
