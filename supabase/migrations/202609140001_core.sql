create extension if not exists pgcrypto;
create extension if not exists citext;
create type public.transaction_kind as enum ('income','expense');
create type public.invoice_status as enum ('paid','to_pay','to_review');
create type public.email_classification as enum ('invoice','receipt','pagopa','payment_confirmation','financial_document','normal','ignore');
create type public.reconciliation_status as enum ('suggested','confirmed','rejected','needs_review');

create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,display_name text,currency char(3) not null default 'EUR',timezone text not null default 'Europe/Rome',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.categories(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null check(char_length(name) between 1 and 80),kind text not null default 'both' check(kind in('income','expense','both')),color text,created_at timestamptz not null default now(),unique(user_id,name,kind));
create table public.accounts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null,institution text,iban_last4 char(4),currency char(3) not null default 'EUR',current_balance numeric(14,2) not null default 0,external_provider text,external_account_id text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,external_provider,external_account_id));
create table public.transactions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,account_id uuid references public.accounts(id) on delete set null,category_id uuid references public.categories(id) on delete set null,kind public.transaction_kind not null,amount numeric(14,2) not null check(amount>0),currency char(3) not null default 'EUR',description text not null check(char_length(description) between 1 and 300),notes text,occurred_on date not null,source text not null default 'manual' check(source in('manual','bank','invoice','email','import')),external_id text,fingerprint text,reconciled boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index transactions_external_unique on public.transactions(user_id,account_id,external_id) where external_id is not null;
create unique index transactions_fingerprint_unique on public.transactions(user_id,fingerprint) where fingerprint is not null;
create index transactions_user_date_idx on public.transactions(user_id,occurred_on desc);

create table public.invoices(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,category_id uuid references public.categories(id) on delete set null,supplier text not null,amount numeric(14,2) not null check(amount>0),currency char(3) not null default 'EUR',invoice_number text,iuv text,issued_on date,due_on date,status public.invoice_status not null default 'to_review',file_hash text,storage_path text,confidence numeric(4,3) check(confidence between 0 and 1),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index invoices_file_hash_unique on public.invoices(user_id,file_hash) where file_hash is not null;
create unique index invoices_iuv_unique on public.invoices(user_id,iuv) where iuv is not null;
create unique index invoices_number_supplier_unique on public.invoices(user_id,supplier,invoice_number) where invoice_number is not null;
create index invoices_user_due_idx on public.invoices(user_id,due_on) where status<>'paid';

create table public.email_accounts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,provider text not null default 'gmail',email_address citext not null,provider_account_id text not null,sync_cursor text,last_synced_at timestamptz,created_at timestamptz not null default now(),unique(user_id,provider,provider_account_id));
create table public.emails(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,email_account_id uuid not null references public.email_accounts(id) on delete cascade,provider_message_id text not null,thread_id text,sender text,subject text,received_at timestamptz,classification public.email_classification not null default 'normal',processing_state text not null default 'pending' check(processing_state in('pending','processing','complete','retry','failed')),retry_count int not null default 0,last_error text,created_at timestamptz not null default now(),unique(email_account_id,provider_message_id));
create table public.attachments(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,email_id uuid references public.emails(id) on delete cascade,invoice_id uuid references public.invoices(id) on delete set null,file_name text not null,mime_type text,byte_size bigint check(byte_size>=0),file_hash text not null,storage_path text not null,created_at timestamptz not null default now(),unique(user_id,file_hash));
create table public.deadlines(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,invoice_id uuid references public.invoices(id) on delete cascade,title text not null,due_on date not null,completed_at timestamptz,created_at timestamptz not null default now(),unique(invoice_id));
create table public.reconciliations(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,invoice_id uuid references public.invoices(id) on delete cascade,transaction_id uuid references public.transactions(id) on delete cascade,status public.reconciliation_status not null default 'suggested',confidence numeric(4,3) check(confidence between 0 and 1),fee_amount numeric(14,2) not null default 0,created_at timestamptz not null default now(),confirmed_at timestamptz,unique(transaction_id));
create table public.learning_rules(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,rule_type text not null,pattern jsonb not null,outcome jsonb not null,confidence numeric(4,3) not null default .5 check(confidence between 0 and 1),confirmations int not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.audit_log(id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete set null,action text not null,entity_type text not null,entity_id uuid,metadata jsonb not null default '{}',created_at timestamptz not null default now());

alter table public.profiles enable row level security;alter table public.categories enable row level security;alter table public.accounts enable row level security;alter table public.transactions enable row level security;alter table public.invoices enable row level security;alter table public.email_accounts enable row level security;alter table public.emails enable row level security;alter table public.attachments enable row level security;alter table public.deadlines enable row level security;alter table public.reconciliations enable row level security;alter table public.learning_rules enable row level security;alter table public.audit_log enable row level security;
create policy profiles_owner on public.profiles for all to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy categories_owner on public.categories for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy accounts_owner on public.accounts for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy transactions_owner on public.transactions for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy invoices_owner on public.invoices for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy email_accounts_owner on public.email_accounts for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy emails_owner on public.emails for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy attachments_owner on public.attachments for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy deadlines_owner on public.deadlines for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy reconciliations_owner on public.reconciliations for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy learning_rules_owner on public.learning_rules for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy audit_owner on public.audit_log for select to authenticated using((select auth.uid())=user_id);

create unique index categories_owner_id_unique on public.categories(user_id,id);
create unique index accounts_owner_id_unique on public.accounts(user_id,id);
create unique index transactions_owner_id_unique on public.transactions(user_id,id);
create unique index invoices_owner_id_unique on public.invoices(user_id,id);
create unique index email_accounts_owner_id_unique on public.email_accounts(user_id,id);
create unique index emails_owner_id_unique on public.emails(user_id,id);
alter table public.transactions add constraint transactions_account_owner_fk foreign key(user_id,account_id) references public.accounts(user_id,id);
alter table public.transactions add constraint transactions_category_owner_fk foreign key(user_id,category_id) references public.categories(user_id,id);
alter table public.invoices add constraint invoices_category_owner_fk foreign key(user_id,category_id) references public.categories(user_id,id);
alter table public.emails add constraint emails_account_owner_fk foreign key(user_id,email_account_id) references public.email_accounts(user_id,id);
alter table public.attachments add constraint attachments_email_owner_fk foreign key(user_id,email_id) references public.emails(user_id,id);
alter table public.attachments add constraint attachments_invoice_owner_fk foreign key(user_id,invoice_id) references public.invoices(user_id,id);
alter table public.deadlines add constraint deadlines_invoice_owner_fk foreign key(user_id,invoice_id) references public.invoices(user_id,id);
alter table public.reconciliations add constraint reconciliations_invoice_owner_fk foreign key(user_id,invoice_id) references public.invoices(user_id,id);
alter table public.reconciliations add constraint reconciliations_transaction_owner_fk foreign key(user_id,transaction_id) references public.transactions(user_id,id);

create index transactions_account_idx on public.transactions(account_id);
create index transactions_category_idx on public.transactions(category_id);
create index invoices_category_idx on public.invoices(category_id);
create index emails_account_idx on public.emails(email_account_id);
create index attachments_email_idx on public.attachments(email_id);
create index attachments_invoice_idx on public.attachments(invoice_id);
create index deadlines_user_idx on public.deadlines(user_id);
create index reconciliations_user_idx on public.reconciliations(user_id);
create index reconciliations_invoice_idx on public.reconciliations(invoice_id);
create index learning_rules_user_idx on public.learning_rules(user_id);
create index audit_log_user_idx on public.audit_log(user_id);

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.profiles,public.categories,public.accounts,public.transactions,public.invoices,public.email_accounts,public.emails,public.attachments,public.deadlines,public.reconciliations,public.learning_rules to authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.soldi_bootstrap_user() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.profiles(id) values(new.id);insert into public.categories(user_id,name,kind,color) values(new.id,'Stipendio','income','#45d49d'),(new.id,'Rimborsi','income','#62b7ff'),(new.id,'Casa','expense','#7b87ff'),(new.id,'Alimentari','expense','#f5bf57'),(new.id,'Trasporti','expense','#ff7187'),(new.id,'Salute','expense','#b782ff');return new;end$$;
create trigger soldi_on_auth_user_created after insert on auth.users for each row execute procedure public.soldi_bootstrap_user();
create or replace function public.soldi_sync_invoice_deadline() returns trigger language plpgsql security definer set search_path='' as $$begin if new.status='to_pay' and new.due_on is not null then insert into public.deadlines(user_id,invoice_id,title,due_on) values(new.user_id,new.id,'Fattura '||new.supplier,new.due_on) on conflict(invoice_id) do update set title=excluded.title,due_on=excluded.due_on,completed_at=null;else update public.deadlines set completed_at=coalesce(completed_at,now()) where invoice_id=new.id;end if;return new;end$$;
create trigger soldi_invoice_deadline_sync after insert or update of status,due_on on public.invoices for each row execute procedure public.soldi_sync_invoice_deadline();
revoke all on function public.soldi_bootstrap_user() from public,anon,authenticated;
revoke all on function public.soldi_sync_invoice_deadline() from public,anon,authenticated;
