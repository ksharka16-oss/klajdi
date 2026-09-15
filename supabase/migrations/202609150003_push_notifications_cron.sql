create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.push_subscriptions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,endpoint)
);

create table if not exists public.notifications(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'gmail',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.soldi_system_secrets(
  name text primary key,
  secret_value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scheduled_sync_runs(
  run_on date primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb not null default '{}'
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.soldi_system_secrets enable row level security;
alter table public.scheduled_sync_runs enable row level security;

create policy push_subscriptions_owner on public.push_subscriptions for all to authenticated
using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy notifications_owner_select on public.notifications for select to authenticated
using((select auth.uid())=user_id);
create policy notifications_owner_update on public.notifications for update to authenticated
using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy notifications_owner_delete on public.notifications for delete to authenticated
using((select auth.uid())=user_id);
create policy soldi_system_secrets_deny_clients on public.soldi_system_secrets for all to authenticated using(false) with check(false);
create policy scheduled_sync_runs_deny_clients on public.scheduled_sync_runs for all to authenticated using(false) with check(false);

revoke all on public.soldi_system_secrets,public.scheduled_sync_runs from anon,authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
grant select,update,delete on public.notifications to authenticated;

select cron.schedule(
  'soldi-gmail-sync-17-rome',
  '0 15,16 * * *',
  $cron$
    select net.http_post(
      url:='https://tgpkewsutphlwmkylemr.supabase.co/functions/v1/gmail-scheduled-sync',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',(select secret_value from public.soldi_system_secrets where name='cron_secret')
      ),
      body:='{}'::jsonb,
      timeout_milliseconds:=10000
    )
  $cron$
);
