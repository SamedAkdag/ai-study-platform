// Map-ordered teacher narrations for Dinle (hub → branch → leaf).
// Secrets: TOKENHARBOR_API_KEY (via mimo / llm shared)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { llmCompleteJson } from '../_shared/llm.ts'
import { getMimoConfig } from '../_shared/mimo.ts'
import { lessonScriptSystemPrompt } from '../_shared/pedagogy.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type TopicIn = { title?: unknown; body?: unknown }
type BranchIn = {
  label?: unknown
  children?: unknown
  page?: unknown
  narration?: unknown
  child_narrations?: unknown
}

function cleanSpeech(raw: unknown, max = 900): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^#{1,6}\s+/g, '')
    .replace(/^\s*[-*+]\s+/g, '')
    .trim()
    .slice(0, max)
}

function lockLabels(
  skeleton: {
    central: string
    branches: Array<{
      label: string
      children: string[]
      page?: number | null
    }>
  },
  ai: Record<string, unknown> | null,
): {
  central: string
  narration: string
  branches: Array<{
    label: string
    children: string[]
    page?: number | null
    narration: string
    child_narrations: string[]
  }>
} {
  const mm =
    ai && typeof ai.mind_map === 'object' && ai.mind_map
      ? (ai.mind_map as Record<string, unknown>)
      : ai && typeof ai === 'object'
        ? ai
        : {}
  const hubNarration = cleanSpeech(mm.narration, 1100)
  const aiBranches = Array.isArray(mm.branches) ? (mm.branches as BranchIn[]) : []

  const byLabel = new Map<string, BranchIn>()
  for (const b of aiBranches) {
    const lab = String(b?.label || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (lab) byLabel.set(lab, b)
  }

  const branches = skeleton.branches.map((sk, bi) => {
    const hit =
      byLabel.get(sk.label.toLowerCase()) ||
      aiBranches[bi] ||
      null
    const kids = sk.children
    const rawKids = Array.isArray(hit?.child_narrations)
      ? (hit!.child_narrations as unknown[])
      : []
    const child_narrations = kids.map((_, i) =>
      cleanSpeech(rawKids[i], 700),
    )
    return {
      label: sk.label,
      children: kids,
      ...(typeof sk.page === 'number' && sk.page >= 1 ? { page: sk.page } : {}),
      narration: cleanSpeech(hit?.narration, 900),
      child_narrations,
    }
  })

  return {
    central: skeleton.central,
    narration: hubNarration,
    branches,
  }
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
          .slice(0, 8)
      : []
    const markdown = String(body?.markdown || '').trim().slice(0, 8000)

    const rawMap = body?.mind_map
    if (!rawMap || typeof rawMap !== 'object') {
      return new Response(JSON.stringify({ error: 'mind_map gerekli' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const central = String(
      (rawMap as { central?: unknown }).central || title,
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    const rawBranches = Array.isArray((rawMap as { branches?: unknown }).branches)
      ? ((rawMap as { branches: BranchIn[] }).branches)
      : []
    const skeleton = {
      central: central || title,
      branches: rawBranches
        .map((b) => {
          const label = String(b?.label || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
          if (!label) return null
          const children = Array.isArray(b?.children)
            ? b.children
                .map((c) => String(c || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .slice(0, 7)
            : []
          const page =
            typeof b?.page === 'number' && b.page >= 1 ? b.page : null
          return { label, children, page }
        })
        .filter((b): b is NonNullable<typeof b> => !!b)
        .slice(0, 10),
    }

    if (skeleton.branches.length < 2) {
      return new Response(
        JSON.stringify({ error: 'En az 2 ana dal gerekli' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const topics: { title: string; body: string }[] = []
    if (Array.isArray(body?.topics)) {
      for (const row of body.topics as TopicIn[]) {
        const t = String(row?.title || '').trim().slice(0, 100)
        const b = String(row?.body || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1800)
        if (t && b.length > 40) topics.push({ title: t, body: b })
        if (topics.length >= 8) break
      }
    }

    const topicsBlock =
      topics.length > 0
        ? topics
            .map((t, i) => `--- Konu ${i + 1}: ${t.title} ---\n${t.body}`)
            .join('\n\n')
        : '(ayrı konu paketi yok — ham notu kullan)'

    const skeletonJson = JSON.stringify({
      central: skeleton.central,
      branches: skeleton.branches.map((b) => ({
        label: b.label,
        page: b.page,
        children: b.children,
      })),
    })

    const system = lessonScriptSystemPrompt()
    const user = `Ünite: ${title}
Özet: ${summary || '(yok)'}
Kavramlar: ${concepts.length ? concepts.join(', ') : '(yok)'}

ZİHİN HARİTASI İSKELETİ (label/children KİLİTLİ — aynen koru):
${skeletonJson}

Konu paketleri (detay kaynağı):
${topicsBlock}

Ek ham not:
${markdown || '(yok)'}

Her düğüm için öğretmen konuşması yaz. Label değiştirme.`

    const { value: parsed, provider } = await llmCompleteJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.35,
      maxTokens: 6500,
      retries: 2,
    })

    const mind_map = lockLabels(skeleton, parsed)
    const spoken = [
      mind_map.narration,
      ...mind_map.branches.flatMap((b) => [
        b.narration,
        ...b.child_narrations,
      ]),
    ]
      .filter((t) => t.length >= 40)
      .join(' ')

    if (spoken.length < 200) {
      throw new Error('Ders script’i çok kısa döndü')
    }

    return new Response(
      JSON.stringify({ mind_map, provider, format: 'lesson_script' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
