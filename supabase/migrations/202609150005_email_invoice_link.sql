alter table public.emails
  add column if not exists extracted_data jsonb not null default '{}'::jsonb,
  add column if not exists confidence numeric(4,3)
    check (confidence between 0 and 1);

alter table public.invoices
  add column if not exists source_email_id uuid;

create unique index if not exists invoices_user_source_email_unique
  on public.invoices (user_id, source_email_id)
  where source_email_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_source_email_owner_fk'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_source_email_owner_fk
      foreign key (user_id, source_email_id)
      references public.emails (user_id, id);
  end if;
end $$;
