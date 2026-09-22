create unique index if not exists reconciliations_one_confirmed_payment_per_invoice
  on public.reconciliations(invoice_id)
  where status = 'confirmed';
