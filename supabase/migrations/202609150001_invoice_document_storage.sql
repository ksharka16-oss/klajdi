insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'invoice-documents',
  'invoice-documents',
  false,
  10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

alter table public.invoices
  add column if not exists document_name text,
  add column if not exists document_mime text,
  add column if not exists document_size bigint check(document_size between 0 and 10485760),
  add column if not exists ocr_status text not null default 'not_requested'
    check(ocr_status in ('not_requested','queued','processing','complete','failed')),
  add column if not exists ocr_text text,
  add column if not exists extracted_data jsonb not null default '{}'::jsonb;

create policy "invoice_documents_select_own"
on storage.objects for select to authenticated
using(bucket_id='invoice-documents' and split_part(name,'/',1)=(select auth.uid())::text);

create policy "invoice_documents_insert_own"
on storage.objects for insert to authenticated
with check(bucket_id='invoice-documents' and split_part(name,'/',1)=(select auth.uid())::text);

create policy "invoice_documents_update_own"
on storage.objects for update to authenticated
using(bucket_id='invoice-documents' and split_part(name,'/',1)=(select auth.uid())::text)
with check(bucket_id='invoice-documents' and split_part(name,'/',1)=(select auth.uid())::text);

create policy "invoice_documents_delete_own"
on storage.objects for delete to authenticated
using(bucket_id='invoice-documents' and split_part(name,'/',1)=(select auth.uid())::text);
