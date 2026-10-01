// Selection-scoped tutor chat (academic framing for Token Harbor moderation).
// Secrets: TOKENHARBOR_API_KEY (MiMo required)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmComplete } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'
import { selectionTutorSystem } from '../_shared/pedagogy.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type HistoryItem = { role: 'user' | 'assistant'; content: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { apiKey: mimoKey } = getMimoConfig()
    if (!mimoKey) {
      throw new Error(
        'TOKENHARBOR_API_KEY missing in Edge secrets — MiMo is required',
      )
    }

    const body = await req.json()
    const chapterTitle = (body?.chapter_title as string) || 'this unit'
    const selectedText = (body?.selected_text as string) || ''
    const precedingContext = (body?.preceding_context as string) || ''
    const followingContext = (body?.following_context as string) || ''
    const question = (body?.question as string) || ''
    const history = (Array.isArray(body?.history) ? body.history : []) as HistoryItem[]

    if (!selectedText.trim() || !question.trim()) {
      return new Response(
        JSON.stringify({ error: 'selected_text and question required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const system = selectionTutorSystem(chapterTitle)

    const contextBlock = `YAKIN METİN (SEÇİMDEN ÖNCE):
${precedingContext || '(yok)'}

SEÇİLİ PASAJ:
${selectedText}

YAKIN METİN (SEÇİMDEN SONRA):
${followingContext || '(yok)'}`

    const framedQuestion = `Bu bir ders çalışması sorusudur.
Öğrencinin sorusu: ${question}

Seçili pasaja ve yakın bağlama göre öğretici cevap ver. Gerekirse bir benzetme ekle; metinde olmayanı uydurma.`

    const messages = [
      { role: 'system' as const, content: system },
      {
        role: 'user' as const,
        content: `${contextBlock}\n\n(Bu ders notu bağlamını kullan.)`,
      },
      ...history.slice(-8).map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: framedQuestion },
    ]

    const { text: answer, provider } = await llmComplete({
      messages,
      temperature: 0.4,
      maxTokens: 900,
    })

    // Surface moderation-style refusals more clearly
    if (/high risk|rejected because/i.test(answer)) {
      return new Response(
        JSON.stringify({
          answer:
            'Model bu soruyu güvenlik filtresinden geçiremedi (Token Harbor “high risk”). ' +
            'Daha nötr sor: örn. “Bu metne göre KİS nedir ve hangi hakları verir?” veya daha geniş bir paragraf seç.',
          provider,
          moderated: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ answer, provider }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
