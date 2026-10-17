import { supabase } from './supabase'

/** Current signed-in user id, or null if anonymous / signed out. */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}
