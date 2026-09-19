create table if not exists public.budgets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  monthly_limit numeric(14,2) not null check(monthly_limit>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,category_id),
  foreign key(user_id,category_id) references public.categories(user_id,id) on delete cascade
);
alter table public.budgets enable row level security;
drop policy if exists budgets_owner on public.budgets;
create policy budgets_owner on public.budgets for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,insert,update,delete on public.budgets to authenticated;
create index if not exists budgets_user_idx on public.budgets(user_id);
