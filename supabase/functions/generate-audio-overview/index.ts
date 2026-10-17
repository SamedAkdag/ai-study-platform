// AI podcast-style dialogue script for Audio Overview (TTS on client).
// Secrets: TOKENHARBOR_API_KEY (via llm shared)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmCompleteJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'
import { TUTOR_PERSONA_TR } from '../_shared/pedagogy.ts'

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
    const { apiKey: mimoKey } = getMimoConfig()
    if (!mimoKey) {
      throw new Error('TOKENHARBOR_API_KEY missing in Edge secrets')
    }

    const body = await req.json()
    const title = String(body?.title || 'Ünite').trim().slice(0, 120)
    const summary = String(body?.summary || '').trim().slice(0, 800)
    const concepts = Array.isArray(body?.key_concepts)
      ? body.key_concepts.map((c: unknown) => String(c || '').trim()).filter(Boolean).slice(0, 8)
      : []
    const markdown = String(body?.markdown || '').trim().slice(0, 4500)

    if (!summary && !markdown && concepts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Özet, kavram veya anlatım metni gerekli' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const system = `${TUTOR_PERSONA_TR}

Görevin: NotebookLM Audio Overview tarzında, İKİ sunuculu kısa Türkçe podcast SENARYOSU yazmak.
Sunucular:
- Ada (host A): sabırlı öğretmen, örnekler ve net açıklama
- Barış (host B): meraklı öğrenci / çalışma arkadaşı; soru sorar, tuzakları yoklar

KURALLAR:
1) Konuşma dili — yazılı ders notu veya madde listesi değil.
2) Kaynakta olmayan bilgi uydurma; emin değilsen "notlarda net değil" de.
3) 8–12 tur (turn). Her tur TEK kişi, 1–3 kısa cümle (max ~280 karakter).
4) Akış: selam + çerçeve → 2–4 kavram/konu derinliği → sık hata / sınav tuzağı → kapanış + pekiştirme ipucu.
5) Formül varsa konuşma diliyle söyle (LaTeX yazma).
6) JSON dışında hiçbir şey yazma.

Return ONLY JSON:
{
  "title":"${title}",
  "turns":[
    {"host":"A","name":"Ada","text":"..."},
    {"host":"B","name":"Barış","text":"..."}
  ]
}`

    const user = `Ünite: ${title}
Özet: ${summary || '(yok)'}
Kavramlar: ${concepts.length ? concepts.join(', ') : '(yok)'}
Anlatım / notlar:
${markdown || '(yok)'}`

    const { value: parsed, provider } = await llmCompleteJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.55,
      maxTokens: 2200,
      retries: 2,
    })

    return new Response(JSON.stringify({ script: parsed, provider }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
