alter table public.email_accounts
  add column if not exists connection_status text not null default 'connected'
    check (connection_status in ('connected','reconnect_required')),
  add column if not exists last_connection_error text;
