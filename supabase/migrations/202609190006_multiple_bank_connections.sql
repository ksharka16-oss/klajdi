drop index if exists public.bank_connections_active_institution_unique;

alter table public.accounts
  add column if not exists bank_connection_id uuid;

create unique index if not exists bank_connections_owner_id_unique
  on public.bank_connections(user_id,id);

update public.accounts as account
set bank_connection_id = (
  select bank_connections.id
  from public.bank_connections
  where bank_connections.user_id = account.user_id
    and bank_connections.institution_name = account.institution
    and bank_connections.provider = 'enablebanking'
    and bank_connections.status = 'linked'
  order by bank_connections.updated_at desc
  limit 1
)
where account.external_provider = 'enablebanking'
  and account.bank_connection_id is null;

alter table public.accounts
  drop constraint if exists accounts_bank_connection_owner_fk;

alter table public.accounts
  add constraint accounts_bank_connection_owner_fk
  foreign key(user_id,bank_connection_id)
  references public.bank_connections(user_id,id)
  on delete set null (bank_connection_id);

create index if not exists accounts_bank_connection_idx
  on public.accounts(bank_connection_id);
