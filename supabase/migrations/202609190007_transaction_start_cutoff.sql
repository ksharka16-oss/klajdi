alter table public.profiles
  add column if not exists transactions_start_on date;

comment on column public.profiles.transactions_start_on is
  'Earliest date from which financial transactions may be stored for this user.';

create or replace function public.enforce_transaction_date_window()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  start_on date;
  today_in_italy date := (now() at time zone 'Europe/Rome')::date;
begin
  select p.transactions_start_on
    into start_on
    from public.profiles as p
   where p.id = new.user_id;

  if start_on is not null and new.occurred_on < start_on then
    raise exception using
      errcode = '23514',
      message = format('La data del movimento non può essere precedente al %s.', to_char(start_on, 'DD/MM/YYYY'));
  end if;

  if new.occurred_on > today_in_italy then
    raise exception using
      errcode = '23514',
      message = 'Non è possibile registrare un movimento con una data futura.';
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_date_window on public.transactions;
create trigger transactions_date_window
before insert or update of occurred_on, user_id on public.transactions
for each row execute function public.enforce_transaction_date_window();
