do $$
declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.bank_connections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provider%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.bank_connections drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.bank_connections alter column provider set default 'enablebanking';
alter table public.bank_connections
  add constraint bank_connections_provider_check
  check(provider in ('gocardless','enablebanking'));

comment on column public.bank_connections.requisition_id is
  'Identificativo sessione o autorizzazione restituito dal provider Open Banking.';
