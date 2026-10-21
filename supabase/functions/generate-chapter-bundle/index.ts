// Toplu üret (warm): notes + detailed in ONE isolate (Cache Hit, Edge-safe).
// Client finishes brief / practice / mind_map as short separate invokes.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getMimoConfig } from '../_shared/mimo.ts'
import { runChapterBundle } from '../_shared/chapterBundleRun.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let chapterIdForFail: string | undefined

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const { apiKey: mimoKey } = getMimoConfig()

    if (!mimoKey) {
      throw new Error('TOKEN_HARBOR_API_KEY missing in Edge secrets')
    }
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    }

    const body = await req.json()
    const chapterId = String(body?.chapter_id || '').trim()
    chapterIdForFail = chapterId
    if (!chapterId) {
      return new Response(JSON.stringify({ error: 'chapter_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const result = await runChapterBundle(admin, {
      chapterId,
      style: body?.style,
      titleHint: body?.title,
      forceArtifacts: body?.force !== false,
      phase: body?.phase === 'full' ? 'full' : 'warm',
    })

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (supabaseUrl && serviceKey && chapterIdForFail) {
        const admin = createClient(supabaseUrl, serviceKey)
        await admin
          .from('chapters')
          .update({ status: 'failed' })
          .eq('id', chapterIdForFail)
      }
    } catch {
      /* ignore */
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
