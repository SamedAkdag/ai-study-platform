// Suggest quiz / example / explanation payloads via MiMo for group contributions.
// Secrets: TOKENHARBOR_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmComplete, safeParseJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'

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
      system = `You create one Turkish study quiz item as JSON only.
type is one of: mcq | true_false | short
Return ONLY JSON:
{"type":"...","question":"...","options":["..."],"correct_index":0,"correct_text":null,"explanation":"..."}
For true_false use options ["Doğru","Yanlış"]. For short use options [] and correct_text filled.`
      user = `Ünite: ${chapterTitle}
İstenen tip: ${quizType}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}`
    } else if (kind === 'example') {
      system = `You create one Turkish worked example as JSON only.
Return ONLY JSON:
{"problem":"...","solution_steps":["adım1","adım2"]}`
      user = `Ünite: ${chapterTitle}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}`
    } else {
      system = `You write a short Turkish study explanation add-on as JSON only.
Return ONLY JSON:
{"title":"...","markdown":"2-4 kısa paragraf markdown","depth":"standard"}`
      user = `Ünite: ${chapterTitle}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}`
    }

    const { text, provider } = await llmComplete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
      maxTokens: 900,
    })

    const parsed = safeParseJson(text)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI JSON parse failed')
    }

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
