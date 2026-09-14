create schema if not exists extensions;
alter extension citext set schema extensions;

create index attachments_user_email_idx on public.attachments(user_id,email_id);
create index attachments_user_invoice_idx on public.attachments(user_id,invoice_id);
create index deadlines_user_invoice_idx on public.deadlines(user_id,invoice_id);
create index emails_user_account_idx on public.emails(user_id,email_account_id);
create index invoices_user_category_idx on public.invoices(user_id,category_id);
create index reconciliations_user_invoice_idx on public.reconciliations(user_id,invoice_id);
create index reconciliations_user_transaction_idx on public.reconciliations(user_id,transaction_id);
create index transactions_user_category_idx on public.transactions(user_id,category_id);
