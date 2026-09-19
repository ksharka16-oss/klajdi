create table if not exists public.bank_connections(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'gocardless' check(provider='gocardless'), institution_id text not null, institution_name text not null,
  requisition_id text unique, status text not null default 'pending' check(status in('pending','linked','expired','error')),
  state_hash text unique, state_expires_at timestamptz, valid_until date, last_synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.bank_connections enable row level security;
create policy bank_connections_owner on public.bank_connections for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,insert,update,delete on public.bank_connections to authenticated;
create index bank_connections_user_status_idx on public.bank_connections(user_id,status);
create unique index bank_connections_active_institution_unique on public.bank_connections(user_id,institution_id) where status in('pending','linked');
