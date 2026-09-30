// Selection-scoped tutor chat (academic framing for Token Harbor moderation).
// Secrets: TOKENHARBOR_API_KEY (MiMo required)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmComplete } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'

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

    const system = `You are a patient academic tutor for the study unit "${chapterTitle}".

CONTEXT RULES:
- Primary source = SELECTED PASSAGE + nearby BEFORE/AFTER lines from the student's study notes.
- Explain clearly in the student's language (usually Turkish).
- You MAY rephrase, define terms, and give simple teaching examples grounded in this context.
- If a detail is not in the context, say what IS known from the text, then state what is missing — do not invent legal/financial procedures.
- Do not refuse normal textbook questions about companies, securities, dividends, or payments when they are study questions.
- Keep answers concrete and helpful (not overly cautious). Prefer 1 short definition + 2–5 bullet points when useful.`

    const contextBlock = `NEARBY TEXT BEFORE SELECTION:
${precedingContext || '(none)'}

SELECTED PASSAGE:
${selectedText}

NEARBY TEXT AFTER SELECTION:
${followingContext || '(none)'}`

    // Academic framing reduces false "high risk" rejections on finance textbooks
    const framedQuestion = `Bu bir ders çalışması sorusudur (hukuk/maliye ders notu).
Öğrencinin sorusu: ${question}

Lütfen seçili ders metnine ve yakın bağlamına göre öğretici bir cevap ver.`

    const messages = [
      { role: 'system' as const, content: system },
      {
        role: 'user' as const,
        content: `${contextBlock}\n\n(Use this study-note context.)`,
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
