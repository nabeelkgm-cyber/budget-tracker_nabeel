-- Budget Tracker cloud sync: run this ONCE in Supabase (SQL Editor -> New query -> paste -> Run).
-- Safe to run again: it only creates what is missing.

create sequence if not exists public.sync_seq;

-- Every record from the app, one row each. "data" holds the whole record as JSON.
create table if not exists public.sync_rows (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text    not null,
  row_id     text    not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,
  seq        bigint  not null default nextval('public.sync_seq'),
  primary key (user_id, tbl, row_id)
);
create index if not exists sync_rows_user_seq on public.sync_rows (user_id, seq);

-- Changes whenever the cloud copy is replaced from scratch, so other devices know to reload.
create table if not exists public.sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  epoch   integer not null default 1
);

-- Privacy: each person can only ever see and change their own rows.
alter table public.sync_rows  enable row level security;
alter table public.sync_state enable row level security;

drop policy if exists "own rows" on public.sync_rows;
create policy "own rows" on public.sync_rows
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own state" on public.sync_state;
create policy "own state" on public.sync_state
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Saves a batch of records. A record is only replaced by a newer change (the latest edit wins).
create or replace function public.sync_push(rows jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  ts bigint;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  gone boolean;
begin
  for r in select * from jsonb_array_elements(rows) loop
    ts := least((r->>'updated_at')::bigint, now_ms + 300000);  -- ignore clocks running far ahead
    gone := coalesce((r->>'deleted')::boolean, false);
    insert into public.sync_rows (user_id, tbl, row_id, data, deleted, updated_at)
    values (auth.uid(), r->>'tbl', r->>'row_id', case when gone then null else r->'data' end, gone, ts)
    on conflict (user_id, tbl, row_id) do update
      set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at,
          seq = nextval('public.sync_seq')
      where public.sync_rows.updated_at <= excluded.updated_at;
  end loop;
end $$;

create or replace function public.sync_epoch() returns integer
language plpgsql security invoker set search_path = public as $$
declare e integer;
begin
  insert into public.sync_state (user_id) values (auth.uid()) on conflict do nothing;
  select epoch into e from public.sync_state where user_id = auth.uid();
  return e;
end $$;

-- Deletes this person's cloud copy and bumps the epoch.
create or replace function public.sync_wipe() returns integer
language plpgsql security invoker set search_path = public as $$
declare e integer;
begin
  delete from public.sync_rows where user_id = auth.uid();
  insert into public.sync_state (user_id) values (auth.uid()) on conflict do nothing;
  update public.sync_state set epoch = epoch + 1 where user_id = auth.uid() returning epoch into e;
  return e;
end $$;

revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.sync_epoch()     from public, anon;
revoke all on function public.sync_wipe()      from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_epoch()     to authenticated;
grant execute on function public.sync_wipe()      to authenticated;
grant select, insert, update, delete on public.sync_rows  to authenticated;
grant select, insert, update, delete on public.sync_state to authenticated;

-- Lets other devices hear about changes instantly.
do $$ begin
  alter publication supabase_realtime add table public.sync_rows;
exception when duplicate_object then null;
end $$;
