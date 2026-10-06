import { createClient } from '@supabase/supabase-js'

const rawUrl = (typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_SUPABASE_URL || '') : '').trim()
const rawKey = (typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_SUPABASE_ANON_KEY || '') : '').trim()

// Fallback to project defaults if not explicitly provided, delayed, or empty
const supabaseUrl = rawUrl || 'https://ephgqrnbpxvxlzloflhy.supabase.co'
const supabaseAnonKey = rawKey || 'sb_publishable_bI5v4Hzokb0A4JWJDzuz1A_4B3lIUX_'

function createSafeSupabaseClient() {
  try {
    const validUrl = supabaseUrl && supabaseUrl.startsWith('http')
      ? supabaseUrl
      : 'https://ephgqrnbpxvxlzloflhy.supabase.co'
    const validKey = supabaseAnonKey || 'sb_publishable_bI5v4Hzokb0A4JWJDzuz1A_4B3lIUX_'
    return createClient(validUrl, validKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  } catch (err) {
    console.warn('Supabase client creation warning/fallback:', err)
    try {
      return createClient('https://ephgqrnbpxvxlzloflhy.supabase.co', 'dummy-key')
    } catch {
      return {
        from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        rpc: () => Promise.resolve({ data: [], error: null }),
        auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      } as any
    }
  }
}

export const supabase = createSafeSupabaseClient()

