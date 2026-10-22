/** Filled in at build time from the .env file (see README). The anon key is meant to be public. */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const syncConfigured = (): boolean => (SUPABASE_URL.startsWith('https://') || SUPABASE_URL.startsWith('http://localhost')) && SUPABASE_ANON_KEY.length > 20;
