alter table public.transactions
  add column if not exists is_transfer boolean not null default false,
  add column if not exists transfer_status text,
  add column if not exists transfer_group_id uuid;

alter table public.transactions
  drop constraint if exists transactions_transfer_status_check;
alter table public.transactions
  add constraint transactions_transfer_status_check
  check(transfer_status is null or transfer_status in('suggested','confirmed','rejected'));

create index if not exists transactions_transfer_review_idx
  on public.transactions(user_id,occurred_on desc)
  where transfer_status='suggested';
