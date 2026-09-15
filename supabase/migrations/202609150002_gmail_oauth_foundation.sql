create table if not exists public.gmail_oauth_states(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.gmail_credentials(
  email_account_id uuid primary key references public.email_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now(),
  unique(user_id,email_account_id)
);

create index if not exists gmail_oauth_states_expiry_idx on public.gmail_oauth_states(expires_at);
create index if not exists gmail_oauth_states_user_idx on public.gmail_oauth_states(user_id);
create index if not exists gmail_credentials_user_idx on public.gmail_credentials(user_id);

alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_credentials enable row level security;

create policy gmail_oauth_states_deny_clients on public.gmail_oauth_states for all to authenticated using(false) with check(false);
create policy gmail_credentials_deny_clients on public.gmail_credentials for all to authenticated using(false) with check(false);

revoke all on public.gmail_oauth_states from anon,authenticated;
revoke all on public.gmail_credentials from anon,authenticated;

grant select,insert,update,delete on public.email_accounts,public.emails to authenticated;
