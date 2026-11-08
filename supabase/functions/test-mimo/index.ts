// Quick AI Gateway ping (plain chat, no JSON mode).

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
        'REQUESTY_API_KEY missing in Edge secrets (AI_GATEWAY_* / TOKENHARBOR_* also accepted)',
      )
    }

    const body = await req.json().catch(() => ({}))
    const message =
      typeof body?.message === 'string' && body.message.trim()
        ? body.message.trim()
        : 'Merhaba, kendini kısaca tanıtır mısın?'
    const imageUrl =
      typeof body?.image_url === 'string' && body.image_url.trim()
        ? body.image_url.trim()
        : ''

    const userContent = imageUrl
      ? [
          { type: 'image_url' as const, image_url: { url: imageUrl } },
          { type: 'text' as const, text: message },
        ]
      : message

    const { text, usage } = await callMimo(
      [{ role: 'user', content: userContent }],
      { json: false, temperature: 0.2, maxTokens: 256 },
    )

    return new Response(
      JSON.stringify({
        ok: true,
        baseURL,
        model,
        vision: !!imageUrl,
        reply: text,
        usage,
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
