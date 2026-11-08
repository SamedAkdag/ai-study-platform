// Selection-scoped tutor chat (academic framing for Token Harbor moderation).
// Secrets: TOKENHARBOR_API_KEY (MiMo required). Supports optional image_url (vision).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { llmComplete } from '../_shared/llm.ts'
import { callMimo, getMimoConfig, type MimoMessage } from '../_shared/mimo.ts'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
  resolveBookContext,
} from '../_shared/aiUsage.ts'
import {
  lectureTutorSystem,
  selectionTutorSystem,
} from '../_shared/pedagogy.ts'

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
    const chapterId = (body?.chapter_id as string) || ''
    const chapterTitle = (body?.chapter_title as string) || 'this unit'
    const selectedText = (body?.selected_text as string) || ''
    const precedingContext = (body?.preceding_context as string) || ''
    const followingContext = (body?.following_context as string) || ''
    const question = (body?.question as string) || ''
    const wantVision = body?.vision === true || body?.vision === 'true'
    const imageUrl =
      typeof body?.image_url === 'string' && body.image_url.trim()
        ? body.image_url.trim()
        : ''
    const history = (Array.isArray(body?.history) ? body.history : []) as HistoryItem[]
    const answerFormat =
      body?.answer_format === 'lecture' || body?.format === 'lecture'
        ? 'lecture'
        : 'notes'

    const hasImage =
      imageUrl.startsWith('data:image/') ||
      imageUrl.startsWith('https://') ||
      imageUrl.startsWith('http://')
    const cleanText = selectedText
      .replace(/〔Grafik\s*\/\s*şekil〕/gi, '')
      .trim()
    const hasText = !!cleanText

    if (wantVision && !hasImage) {
      return new Response(
        JSON.stringify({
          error:
            'vision=true ama image_url yok veya geçersiz. Alanı yeniden seç.',
          vision: false,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if ((!hasText && !hasImage) || !question.trim()) {
      return new Response(
        JSON.stringify({
          error: 'selected_text or image_url, and question required',
          vision: false,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const lectureMode = answerFormat === 'lecture' && !hasImage
    const system = lectureMode
      ? lectureTutorSystem(chapterTitle)
      : selectionTutorSystem(chapterTitle)

    const contextBlock = hasImage
      ? `Öğrenci PDF sayfasından bir GRAFİK/ŞEKİL kırptı. Asıl kaynak EKTEKİ GÖRÜNTÜDÜR (image).
Yer tutucu metin yok say — eksen, eğri, çubuk, sayı, etiketleri görüntüden oku.
Grafiğin ÜSTÜNDEKİ / ALTINDAkİ cümleler başlık, kaynak, yorum için destekler; görüntüyle çelişirse görüntüye güven.
${hasText ? `Ek etiket metni:\n${cleanText}\n` : ''}
GRAFİK ÜSTÜ (~son 10 cümle):
${precedingContext || '(yok)'}

GRAFİK ALTI (~ilk 10 cümle):
${followingContext || '(yok)'}`
      : lectureMode
        ? `ANLATIM BAĞLAMI (HOCANIN ŞU AN ANLATTIĞI DÜĞÜM / ÖNCE–SONRA):

ÖNCEKİ ANLATIM:
${precedingContext || '(yok)'}

ŞU ANKİ ANLATIM:
${cleanText}

SONRAKİ ANLATIM:
${followingContext || '(yok)'}`
        : `YAKIN METİN (SEÇİMDEN ÖNCE):
${precedingContext || '(yok)'}

SEÇİLİ PASAJ:
${cleanText}

YAKIN METİN (SEÇİMDEN SONRA):
${followingContext || '(yok)'}`

    const framedQuestion = hasImage
      ? `Bu bir ders çalışması sorusudur.
Öğrencinin sorusu: ${question}

ZORUNLU: Ekteki görüntüyü incele. Eksen adları, birimler, eğri/çubuk şekilleri, okunabilen değerler.
Görüntüdeki içeriği tarif et; genel “grafik nasıl okunur” dersi VERME.
Okuyamadığın sayıyı uydurma. Öğretici, kısa, mümkünse mini tablo.`
      : lectureMode
        ? `İstenen: TEK SÜREKLİ HOCA ANLATIMI — ton ders gibi (Dinle sekmesindeki hoca anlatımı ile AYNI üslup).
Öğrenci harita turunda araya girdi. Sorusu: ${question}

Bağlamdaki anlatıma dayan; uydurma. Tablo/madde/markdown yazma — sadece konuşma.
İstersen sonunda “şimdi derse kaldığımız yerden devam edebiliriz” de.`
        : `Bu bir ders çalışması sorusudur.
Öğrencinin sorusu: ${question}

Seçili pasaja ve yakın bağlama göre öğretici cevap ver. Gerekirse bir benzetme ekle; metinde olmayanı uydurma.`

    let answer: string
    let provider: 'mimo' | 'groq' | 'gemini' = 'mimo'
    let usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      cached_tokens: number
      estimated: boolean
    }

    if (hasImage) {
      const messages: MimoMessage[] = [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            {
              type: 'text',
              text: `${contextBlock}\n\n(Görüntü birincil kaynaktır.)`,
            },
          ],
        },
        ...history.slice(-6).map((h) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        })),
        { role: 'user', content: framedQuestion },
      ]
      const result = await callMimo(messages, {
        json: false,
        temperature: 0.35,
        // Vision explain + mini table; ~1.5k is enough without essay bloat
        maxTokens: 1536,
      })
      answer = result.text
      usage = result.usage
      provider = 'mimo'
    } else {
      // Ask budgets (reasoning off): lecture TTS ~120–200 words → ~1k ceiling;
      // PDF/notes answers with table/benzetme → ~1.5k. 480 was a legacy “speed”
      // cap that truncated pedagogy and broke Ling when thinking ate the budget.
      const histN = lectureMode ? 4 : 8
      const maxTokens = lectureMode ? 1024 : 1536
      const temperature = lectureMode ? 0.35 : 0.4
      const messages = [
        { role: 'system' as const, content: system },
        {
          role: 'user' as const,
          content: lectureMode
            ? `${contextBlock}\n\n(Bu anlatım bağlamını kullan.)`
            : `${contextBlock}\n\n(Bu ders notu bağlamını kullan.)`,
        },
        ...history.slice(-histN).map((h) => ({
          role: h.role as 'user' | 'assistant',
          content: lectureMode
            ? h.content.slice(0, 900)
            : h.content,
        })),
        { role: 'user' as const, content: framedQuestion },
      ]
      const result = await llmComplete({
        messages,
        temperature,
        maxTokens,
      })
      answer = result.text
      usage = result.usage
      provider = result.provider
    }

    const usageBag = createUsageBag()
    recordUsage(usageBag, usage, provider)

    const usagePayload = {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      estimated: usage.estimated,
    }

    // Log AFTER answering — don't block the student on DB usage writes
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (supabaseUrl && serviceKey && chapterId) {
      const logTask = (async () => {
        try {
          const admin = createClient(supabaseUrl, serviceKey)
          const bookCtx = await resolveBookContext(admin, chapterId)
          await logAiUsage(admin, {
            operation: hasImage ? 'chapter_chat_vision' : 'chapter_chat',
            bookId: bookCtx.bookId,
            chapterId,
            userId: bookCtx.userId,
            bag: usageBag,
          })
        } catch (logErr) {
          console.warn('chat usage log skipped', logErr)
        }
      })()
      const edgeWait = (
        globalThis as {
          EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
        }
      ).EdgeRuntime?.waitUntil
      if (typeof edgeWait === 'function') edgeWait(logTask)
      else void logTask
    }

    if (/high risk|rejected because/i.test(answer)) {
      return new Response(
        JSON.stringify({
          answer:
            'Model bu soruyu güvenlik filtresinden geçiremedi (Token Harbor “high risk”). ' +
            'Daha nötr sor: örn. “Bu grafikte X ekseni neyi gösteriyor?” veya daha geniş bir alan seç.',
          provider,
          moderated: true,
          vision: hasImage,
          usage: usagePayload,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        answer,
        provider,
        usage: usagePayload,
        vision: hasImage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message, vision: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
