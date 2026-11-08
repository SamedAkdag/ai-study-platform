// Chat goal → topic book units (page_text SOURCE, no PDF).
// Secrets: REQUESTY_API_KEY (or AI_GATEWAY_* / TOKENHARBOR_*)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getMimoConfig } from '../_shared/mimo.ts'
import { llmCompleteJson } from '../_shared/llm.ts'
import {
  createUsageBag,
  logAiUsage,
  recordUsage,
} from '../_shared/aiUsage.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type TopicChapter = {
  title: string
  summary: string
  key_concepts: string[]
  page_text: string
}

type TopicPlan = {
  book_title: string
  subject: string | null
  chapters: TopicChapter[]
}

function sanitizeText(s: string, max = 24_000): string {
  return s.replace(/\u0000/g, '').trim().slice(0, max)
}

function normalizePlan(raw: unknown, goal: string): TopicPlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const bookTitle =
    sanitizeText(String(o.book_title || o.title || goal), 120) ||
    goal.slice(0, 80) ||
    'Konu çalışması'
  const subjectRaw = String(o.subject || '').trim()
  const subject = subjectRaw ? sanitizeText(subjectRaw, 80) : null

  const list = Array.isArray(o.chapters) ? o.chapters : []
  const chapters: TopicChapter[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const title = sanitizeText(String(c.title || ''), 160)
    const page_text = sanitizeText(String(c.page_text || c.source || ''), 20_000)
    if (!title || page_text.length < 180) continue
    const concepts = Array.isArray(c.key_concepts)
      ? c.key_concepts
          .map((x) => sanitizeText(String(x), 80))
          .filter(Boolean)
          .slice(0, 8)
      : []
    chapters.push({
      title,
      summary: sanitizeText(String(c.summary || ''), 600) || title,
      key_concepts: concepts,
      page_text,
    })
  }

  if (chapters.length === 0) {
    throw new Error('Konu planı boş döndü — tekrar dene')
  }

  return {
    book_title: bookTitle,
    subject,
    chapters: chapters.slice(0, 6),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let bookIdForFail: string | undefined

  try {
    const { apiKey: mimoKey } = getMimoConfig()
    if (!mimoKey) {
      throw new Error(
        'REQUESTY_API_KEY missing in Edge secrets — topic study requires LLM',
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    }

    const body = await req.json()
    const bookId = String(body?.book_id || '').trim()
    bookIdForFail = bookId || undefined
    const goal = sanitizeText(String(body?.goal || ''), 500)
    const level = sanitizeText(String(body?.level || 'genel'), 80) || 'genel'
    const depth = body?.depth === 'path' ? 'path' : 'one'
    const subjectHint = sanitizeText(String(body?.subject || ''), 80)

    if (!bookId) {
      return new Response(JSON.stringify({ error: 'book_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (goal.length < 3) {
      return new Response(JSON.stringify({ error: 'goal required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: book, error: bookErr } = await admin
      .from('books')
      .select('id, title, status')
      .eq('id', bookId)
      .maybeSingle()

    if (bookErr || !book) {
      return new Response(JSON.stringify({ error: 'book not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await admin
      .from('books')
      .update({
        status: 'processing',
        progress_step: 'topic_planning',
        error_message: null,
        source_kind: 'topic',
      })
      .eq('id', bookId)

    const unitCount = depth === 'path' ? '3 ile 5 arasında' : 'tam 1'
    const system = `Sen Studium konu mimarısın. Kullanıcının öğrenme niyetinden PDF olmadan çalışılabilir üniteler üretirsin.
Çıktı SADECE geçerli JSON. Her ünitenin page_text alanı, sonraki Anlatım/quiz/harita için KAYNAK metindir:
- Türkçe, öğretici, somut
- Madde işaretleri ve kısa paragraflar
- Uydurma makale/atıf yok; genel öğretim dili
- Her page_text en az ~280 kelime, net ve yoğun`

    const user = `Öğrenme hedefi: ${goal}
Seviye / amaç: ${level}
${subjectHint ? `Ders ipucu: ${subjectHint}\n` : ''}Ünite sayısı: ${unitCount}

JSON şema:
{
  "book_title": "kısa kitap/konu adı",
  "subject": "Math|Physics|History|Law|Other veya Türkçe ders adı",
  "chapters": [
    {
      "title": "ünite başlığı",
      "summary": "1-2 cümle",
      "key_concepts": ["…", "…"],
      "page_text": "uzun öğretim kaynağı (markdown-benzeri düz metin)"
    }
  ]
}`

    const usageBag = createUsageBag()
    const { data: bookOwner } = await admin
      .from('books')
      .select('user_id')
      .eq('id', bookId)
      .maybeSingle()
    // Same JSON helper as PDF chapter notes — retries without response_format
    // when Ling/Novita returns opaque 400 Bad Request.
    const { value, usage, provider } = await llmCompleteJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.35,
      maxTokens: depth === 'path' ? 4000 : 2600,
      retries: 2,
      skipRepairCall: true,
    })
    recordUsage(usageBag, usage, provider)

    const plan = normalizePlan(value, goal)

    await admin.from('chapters').delete().eq('book_id', bookId)

    const rows = plan.chapters.map((c, i) => {
      const n = i + 1
      return {
        book_id: bookId,
        chapter_number: n,
        order_index: n,
        title: c.title,
        start_page: n,
        end_page: n,
        summary: c.summary,
        key_concepts: c.key_concepts,
        page_text: `--- Topic unit ${n} ---\n${c.page_text}`,
        status: 'pending' as const,
      }
    })

    const { data: inserted, error: insErr } = await admin
      .from('chapters')
      .insert(rows)
      .select('id, title, order_index, status')

    if (insErr) throw insErr

    const nextTitle =
      plan.book_title && plan.book_title !== 'Konu çalışması'
        ? plan.book_title
        : book.title

    await admin
      .from('books')
      .update({
        title: nextTitle,
        subject: plan.subject || subjectHint || null,
        status: 'ready',
        progress_step: 'topic_ready',
        source_kind: 'topic',
        total_pages: plan.chapters.length,
        file_url: null,
        error_message: null,
      })
      .eq('id', bookId)

    await logAiUsage(admin, {
      operation: 'topic_study',
      bag: usageBag,
      bookId,
      userId: (bookOwner?.user_id as string | undefined) || null,
      meta: { depth, units: plan.chapters.length },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        book_id: bookId,
        book_title: nextTitle,
        chapters: inserted ?? [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (bookIdForFail) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (supabaseUrl && serviceKey) {
          const admin = createClient(supabaseUrl, serviceKey)
          await admin
            .from('books')
            .update({
              status: 'failed',
              progress_step: 'topic_failed',
              error_message: msg.slice(0, 500),
            })
            .eq('id', bookIdForFail)
        }
      } catch {
        /* ignore */
      }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
