// Continuous teacher classroom lecture — deep per-topic teaching, one monologue.
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

type TopicIn = { title?: unknown; body?: unknown }

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
          .slice(0, 8)
      : []
    const markdown = String(body?.markdown || '').trim().slice(0, 8000)

    const topics: { title: string; body: string }[] = []
    if (Array.isArray(body?.topics)) {
      for (const row of body.topics as TopicIn[]) {
        const t = String(row?.title || '').trim().slice(0, 100)
        const b = String(row?.body || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2200)
        if (t && b.length > 40) topics.push({ title: t, body: b })
        if (topics.length >= 8) break
      }
    }

    if (!summary && !markdown && concepts.length === 0 && topics.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Özet, kavram veya anlatım metni gerekli' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const topicsBlock =
      topics.length > 0
        ? topics
            .map(
              (t, i) =>
                `--- Konu ${i + 1}: ${t.title} ---\n${t.body}`,
            )
            .join('\n\n')
        : '(ayrı konu paketi yok — aşağıdaki ham notu kullan)'

    const system = `${TUTOR_PERSONA_TR}

Görevin: Kaynak notlardan TEK PARÇA, SÜREKLİ, DETAYLI bir DERS ANLATIMI yazmak.
Dinleyen kişi “şu an bir hoca sınıfta ders anlatıyor” demeli — hem ton doğru, hem İÇERİK ZENGİN.

DETAY STRATEJİSİ (çok önemli):
- Sana "Konu 1… Konu N" paketleri geliyorsa her konuyu SIRAYLA ve DERİN işle.
- Her konu için konuşurken şunları geç (başlık yazmadan, konuşarak):
  1) Tanım / ne olduğunu kendi cümlelerinle
  2) Neden önemli (sınav / uygulama)
  3) Kaynaktaki somut detay — en az 4–7 cümle; özetleyip geçme, kaynağın etini kullan
  4) Mini örnek, benzetme veya "burada sık düşülüyor" tuzağı
- Konular arasında doğal geçiş cümlesi kullan ("Şimdi şuraya geliyoruz…").
- Kaynakta olmayan bilgi uydurma; emin değilsen "notlarda net değil" de.
- Formülü konuşma diliyle söyle (ham LaTeX yazma).

TON:
- "Bakın…", "Dikkat edin…", "Şimdi şunu netleştirelim…", "Örnek veriyorum…"
- ÖZET DEĞİL. Madde listesi, blog başlığı, "##", "Bölüm 1", podcast, diyalog YASAK.

UZUNLUK:
- narration en az ~3500 karakter (konu sayısı azsa yine zengin anlat; uydurma).
- Konu çoksa hepsini işle; acele özetleme.

ÇIKTI:
- "narration": tek string, düz konuşma. İsteğe bağlı \\n\\n paragraf.
- turns / blog GÖNDERME. JSON dışında hiçbir şey yazma.

Return ONLY JSON:
{
  "title":"${title}",
  "format":"lecture",
  "narration":"Merhaba, defterinizi açın. Bugün…"
}`

    const user = `Ünite: ${title}
İstenen: TEK SÜREKLİ HOCA ANLATIMI — ton ders gibi, içerik DETAYLI (her konu derin)
Özet: ${summary || '(yok)'}
Kavramlar: ${concepts.length ? concepts.join(', ') : '(yok)'}

Konu paketleri (asıl detay kaynağı — her birini işle):
${topicsBlock}

Ek ham not (gerekirse):
${markdown || '(yok)'}`

    const { value: parsed, provider } = await llmCompleteJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      maxTokens: 7000,
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
