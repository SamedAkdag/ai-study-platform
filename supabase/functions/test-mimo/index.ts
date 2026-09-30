// Quick MiMo ping — same shape as Token Harbor Python example (plain chat, no JSON mode).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { callMimo, getMimoConfig } from '../_shared/mimo.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { apiKey, baseURL, model } = getMimoConfig()
    if (!apiKey) {
      throw new Error(
        'TOKENHARBOR_API_KEY missing in Edge secrets (or TOKEN_HARBOR_API_KEY)',
      )
    }

    const body = await req.json().catch(() => ({}))
    const message =
      typeof body?.message === 'string' && body.message.trim()
        ? body.message.trim()
        : 'Merhaba, kendini kısaca tanıtır mısın?'

    const text = await callMimo(
      [{ role: 'user', content: message }],
      { json: false, temperature: 0.7, maxTokens: 256 },
    )

    return new Response(
      JSON.stringify({
        ok: true,
        baseURL,
        model,
        reply: text,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const { baseURL, model } = getMimoConfig()
    return new Response(
      JSON.stringify({
        ok: false,
        error: message,
        baseURL,
        model,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
