// Suggest quiz / example / explanation payloads via MiMo for group contributions
// and on-demand Alıştır expansion (batch + difficulty).
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

type Difficulty = 'easy' | 'medium' | 'hard'

function normalizeDifficulty(raw: unknown): Difficulty {
  const s = String(raw || 'medium')
    .trim()
    .toLowerCase()
  if (s === 'easy' || s === 'kolay') return 'easy'
  if (s === 'hard' || s === 'zor' || s === 'difficult') return 'hard'
  return 'medium'
}

function difficultyGuide(d: Difficulty): string {
  if (d === 'easy') {
    return `ZORLUK = KOLAY:
- Temel tanım / doğrudan uygulama
- Tek adım veya tek kavram
- Şıklar net; tuzak az
- Dil sade, kısa soru`
  }
  if (d === 'hard') {
    return `ZORLUK = ZOR:
- Çok adımlı akıl yürütme veya kavram birleştirme
- İnce tuzaklar / sınav stili
- “Neden / nasıl” derinliği
- Yüzeysel ezberle çözülmesin`
  }
  return `ZORLUK = ORTA:
- Tipik ünite sınavı seviyesi
- 1–2 adım uygulama
- Makul çeldiriciler`
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
    const context = String(body?.context || '').slice(0, 3500)
    const difficulty = normalizeDifficulty(body?.difficulty)
    const countRaw = Number(body?.count)
    const count = Number.isFinite(countRaw)
      ? Math.min(10, Math.max(1, Math.round(countRaw)))
      : 1
    const avoid = Array.isArray(body?.avoid)
      ? body.avoid.map((x: unknown) => String(x || '').trim()).filter(Boolean).slice(0, 24)
      : []

    if (!hint && !context) {
      return new Response(
        JSON.stringify({ error: 'hint veya context gerekli' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const avoidBlock =
      avoid.length > 0
        ? `\nKaçın (benzer soru/problem yazma):\n- ${avoid.join('\n- ')}`
        : ''
    const diffBlock = difficultyGuide(difficulty)

    let system = ''
    let user = ''
    let maxTokens = 900

    if (kind === 'quiz') {
      if (count > 1) {
        system = `${TUTOR_PERSONA_TR}
${TUTOR_RULES_TR}
${diffBlock}

Türkçe sınav soruları üret (çoğunlukla mcq; 1 true_false veya short olabilir).
Mevcut maddeleri kopyalama. Her madde bağımsız olsun.
Return ONLY JSON:
{"items":[
  {"type":"mcq","question":"...","options":["A","B","C","D"],"correct_index":0,"correct_text":null,"explanation":"doğru neden + tuzaklar"},
  {"type":"true_false","question":"...","options":["Doğru","Yanlış"],"correct_index":0,"correct_text":null,"explanation":"..."}
]}
Tam ${count} madde.`
        user = `Ünite: ${chapterTitle}
İstenen tip (tercih): ${quizType}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(ünite başlığına göre üret)'}
${avoidBlock}`
        maxTokens = 1600
      } else {
        system = `${TUTOR_PERSONA_TR}
${TUTOR_RULES_TR}
${diffBlock}

Tek bir Türkçe quiz maddesi üret. type: mcq | true_false | short
Return ONLY JSON:
{"type":"...","question":"...","options":["..."],"correct_index":0,"correct_text":null,"explanation":"doğru neden + yanlış şık tuzakları"}
true_false options: ["Doğru","Yanlış"]. short: options [] + correct_text.`
        user = `Ünite: ${chapterTitle}
İstenen tip: ${quizType}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}
${avoidBlock}`
      }
    } else if (kind === 'example') {
      if (count > 1) {
        system = `${TUTOR_PERSONA_TR}
${diffBlock}

Çözümlü örnekler üret. Adımlar mantıksal ve numaralı olsun.
Return ONLY JSON:
{"items":[
  {"problem":"...","solution_steps":["1. …","2. …","3. sonuç"]}
]}
Tam ${count} örnek. Birbirini kopyalama.`
        user = `Ünite: ${chapterTitle}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(ünite başlığına göre üret)'}
${avoidBlock}`
        maxTokens = 1400
      } else {
        system = `${TUTOR_PERSONA_TR}
${diffBlock}

Çözümlü örnek üret. Adımlar mantıksal olsun.
Return ONLY JSON:
{"problem":"...","solution_steps":["adım1","adım2"]}`
        user = `Ünite: ${chapterTitle}
İpucu: ${hint || '(yok)'}
Bağlam:
${context || '(yok)'}
${avoidBlock}`
      }
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
      temperature: difficulty === 'hard' ? 0.65 : difficulty === 'easy' ? 0.4 : 0.55,
      maxTokens,
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
