alter table public.emails
  add column if not exists financial_status text;

alter table public.emails
  drop constraint if exists emails_financial_status_check;

alter table public.emails
  add constraint emails_financial_status_check
  check (
    financial_status is null
    or financial_status in ('paid', 'to_pay', 'to_review')
  );

update public.emails
set financial_status = case
  when classification in ('receipt', 'payment_confirmation') then 'paid'
  when classification in ('invoice', 'pagopa') then 'to_pay'
  else null
end
where processing_state = 'complete';

create index if not exists emails_user_financial_received_idx
  on public.emails (user_id, received_at desc)
  where financial_status is not null;
