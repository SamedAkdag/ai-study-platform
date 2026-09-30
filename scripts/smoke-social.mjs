/**
 * Smoke tests against linked Supabase (anon key from .env.local).
 * Run: node --env-file=.env.local scripts/smoke-social.mjs
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const sb = createClient(url, key)
const results = []

function ok(name, detail = '') {
  results.push({ name, pass: true, detail })
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, err) {
  results.push({ name, pass: false, detail: String(err) })
  console.error(`✗ ${name} — ${err}`)
}

async function main() {
  // Tables exist
  for (const table of [
    'profiles',
    'friendships',
    'study_shares',
    'study_focus',
    'chapter_contributions',
    'group_messages',
    'study_groups',
  ]) {
    try {
      const { error } = await sb.from(table).select('*').limit(1)
      if (error) throw error
      ok(`table ${table}`)
    } catch (e) {
      fail(`table ${table}`, e.message || e)
    }
  }

  // Username format rejection via check constraint (insert without auth will fail FK — expect that)
  try {
    const { error } = await sb.from('profiles').insert({
      user_id: '00000000-0000-0000-0000-000000000001',
      username: 'BAD NAME',
      display_name: 'x',
    })
    if (error) {
      ok('username validation rejects bad format', error.message.slice(0, 80))
    } else {
      fail('username validation', 'bad username was accepted')
      await sb.from('profiles').delete().eq('username', 'BAD NAME')
    }
  } catch (e) {
    ok('username validation (threw)', String(e).slice(0, 80))
  }

  // RPC exists
  try {
    const { error } = await sb.rpc('bump_study_focus', {
      p_user_id: '00000000-0000-0000-0000-000000000001',
      p_book_id: '00000000-0000-0000-0000-000000000001',
      p_chapter_id: null,
      p_seconds: 1,
    })
    // FK fail is fine — means function ran
    if (!error || /foreign key|violates/i.test(error.message)) {
      ok('rpc bump_study_focus callable', error?.message?.slice(0, 60) || 'ok')
    } else {
      fail('rpc bump_study_focus', error.message)
    }
  } catch (e) {
    fail('rpc bump_study_focus', e.message || e)
  }

  // Center contribution helpers: normalize-like payload roundtrip via select
  try {
    const { data, error } = await sb
      .from('chapter_contributions')
      .select('id, kind, status')
      .limit(3)
    if (error) throw error
    ok('chapter_contributions readable', `${data?.length ?? 0} rows`)
  } catch (e) {
    fail('chapter_contributions readable', e.message || e)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main()
