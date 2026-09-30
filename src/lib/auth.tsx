import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getOrCreateMemberKey, setStoredDisplayName } from '@/lib/memberIdentity'
import {
  fetchMyProfile,
  normalizeUsername,
  upsertMyProfile,
} from '@/lib/social'
import type { Profile } from '@/types/database'

type AuthState = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName?: string,
  ) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function linkMemberToUser(user: User, displayName?: string) {
  const memberKey = getOrCreateMemberKey()
  const metaName =
    displayName ||
    (typeof user.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name
      : '')
  if (metaName) setStoredDisplayName(metaName)

  await supabase
    .from('group_members')
    .update({ user_id: user.id })
    .eq('member_key', memberKey)
    .is('user_id', null)

  if (metaName) {
    await supabase
      .from('group_members')
      .update({ display_name: metaName })
      .eq('user_id', user.id)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshProfile(userId?: string) {
    const id = userId ?? (await supabase.auth.getSession()).data.session?.user?.id
    if (!id) {
      setProfile(null)
      return
    }
    const p = await fetchMyProfile(id)
    setProfile(p)
  }

  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) {
        await linkMemberToUser(data.session.user)
        const p = await fetchMyProfile(data.session.user.id)
        if (mounted) setProfile(p)
      }
      if (mounted) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next?.user) {
        void (async () => {
          await linkMemberToUser(next.user)
          const p = await fetchMyProfile(next.user.id)
          setProfile(p)
        })()
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signUp(
    email: string,
    password: string,
    username: string,
    displayName?: string,
  ) {
    const u = normalizeUsername(username)
    const name = (displayName || u).trim()
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name, username: u },
      },
    })
    if (error) throw error
    if (!data.user) throw new Error('Kayıt tamamlanamadı')
    setStoredDisplayName(name)
    await upsertMyProfile({
      userId: data.user.id,
      username: u,
      displayName: name,
    })
    await linkMemberToUser(data.user, name)
    await refreshProfile(data.user.id)
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw error
    if (data.user) {
      await linkMemberToUser(data.user)
      await refreshProfile(data.user.id)
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        refreshProfile,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
