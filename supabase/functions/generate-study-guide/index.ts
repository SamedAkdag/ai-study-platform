// AI study guide for a chapter (NotebookLM-style briefing pack).
// Secrets: TOKENHARBOR_API_KEY

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
      ? body.key_concepts
          .map((c: unknown) => String(c || '').trim())
          .filter(Boolean)
          .slice(0, 10)
      : []
    const markdown = String(body?.markdown || '').trim().slice(0, 4500)
    const quizHints = Array.isArray(body?.quiz_questions)
      ? body.quiz_questions
          .map((q: unknown) => String(q || '').trim())
          .filter(Boolean)
          .slice(0, 8)
      : []

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

Görevin: sınava hazırlık için kısa Türkçe ÇALIŞMA KILAVUZU üretmek.
Kaynakta olmayan bilgi uydurma.

Return ONLY JSON:
{
  "title":"${title}",
  "briefing":"2-4 cümle brifing (neden önemli + omurga)",
  "keyTerms":[{"term":"...","gloss":"tek cümle anlam"}],
  "mustKnow":["madde1","madde2"],
  "quizWarmup":[{"q":"kısa kontrol sorusu","hint":"ipucu"}],
  "essayPrompts":["açık uçlu deneme sorusu"]
}

Kurallar:
- keyTerms: 4–8 madde
- mustKnow: 4–8 madde (ezber / sınav kartı)
- quizWarmup: 3–5 kısa soru (cevap yazma; sadece soru + kısa hint)
- essayPrompts: 2–3 madde
- Dil sade, konuşur gibi; madde listesi robotik olmasın`

    const user = `Ünite: ${title}
Özet: ${summary || '(yok)'}
Kavramlar: ${concepts.length ? concepts.join(', ') : '(yok)'}
Mevcut quiz örnekleri: ${quizHints.length ? quizHints.join(' | ') : '(yok)'}
Anlatım:
${markdown || '(yok)'}`

    const { value: parsed, provider } = await llmCompleteJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.45,
      maxTokens: 2000,
      retries: 2,
    })

    return new Response(JSON.stringify({ guide: parsed, provider }), {
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
