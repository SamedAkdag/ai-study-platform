// Suggest quiz / example / explanation payloads via MiMo for group contributions.
// Secrets: TOKENHARBOR_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmCompleteJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'
import { TUTOR_PERSONA_TR, TUTOR_RULES_TR } from '../_shared/pedagogy.ts'

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
    const kind = String(body?.kind || 'quiz')
    const chapterTitle = String(body?.chapter_title || 'ünite')
    const hint = String(body?.hint || '').trim()
    const quizType = String(body?.quiz_type || 'mcq')
    const context = String(body?.context || '').slice(0, 2500)

    if (!hint && !context) {
      return new Response(
        JSON.stringify({ error: 'hint veya context gerekli' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    let system = ''
    let user = ''

    if (kind === 'quiz') {
      system = `${TUTOR_PERSONA_TR}
${TUTOR_RULES_TR}
Tek bir Türkçe quiz maddesi üret. type: mcq | true_false | short
Return ONLY JSON:
{"type":"...","question":"...","options":["..."],"correct_index":0,"correct_text":null,"explanation":"doğru neden + yanlış şık tuzakları"}
true_false options: ["Doğru","Yanlış"]. short: options [] + correct_text.`
      user = `Ünite: ${chapterTitle}
İstenen tip: ${quizType}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}`
    } else if (kind === 'example') {
      system = `${TUTOR_PERSONA_TR}
Çözümlü örnek üret. Adımlar mantıksal olsun.
Return ONLY JSON:
{"problem":"...","solution_steps":["adım1","adım2"]}`
      user = `Ünite: ${chapterTitle}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}`
    } else {
      system = `${TUTOR_PERSONA_TR}
Kısa ek anlatım: neden önemli + 1 benzetme + sık hata uyarısı.
Return ONLY JSON:
{"title":"...","markdown":"2-4 kısa paragraf markdown","depth":"standard"}`
      user = `Ünite: ${chapterTitle}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}`
    }

    const { value: parsed, provider } = await llmCompleteJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
      maxTokens: 900,
      retries: 2,
    })

    return new Response(JSON.stringify({ payload: parsed, provider }), {
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
