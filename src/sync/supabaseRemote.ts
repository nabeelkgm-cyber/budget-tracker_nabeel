import { SupabaseClient, createClient } from '@supabase/supabase-js';
import type { Remote, RemoteRow } from './engine';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/** The one Supabase connection. The login is kept in the browser so you stay signed in. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

export function supabaseRemote(c: SupabaseClient = supabase()): Remote {
  return {
    async push(rows) {
      const { error } = await c.rpc('sync_push', { rows });
      fail(error);
    },
    async pull(afterSeq, limit) {
      const { data, error } = await c
        .from('sync_rows')
        .select('tbl,row_id,data,deleted,updated_at,seq')
        .gt('seq', afterSeq)
        .order('seq', { ascending: true })
        .limit(limit);
      fail(error);
      return (data ?? []) as RemoteRow[];
    },
    async hasData() {
      const { count, error } = await c.from('sync_rows').select('row_id', { count: 'exact', head: true });
      fail(error);
      return (count ?? 0) > 0;
    },
    async getEpoch() {
      const { data, error } = await c.rpc('sync_epoch');
      fail(error);
      return Number(data);
    },
    async wipe() {
      const { data, error } = await c.rpc('sync_wipe');
      fail(error);
      return Number(data);
    },
  };
}
