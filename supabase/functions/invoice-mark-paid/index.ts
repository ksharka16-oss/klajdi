import { corsHeaders, currentUser, json, adminClient } from '../_shared/gmail.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  const body = await req.json().catch(() => ({})), invoiceId = String(body.invoice_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json({ error: 'Fattura non valida.' }, 400, origin)
  const admin = adminClient(), { data: invoice, error: invoiceError } = await admin.from('invoices').select('id,user_id,supplier,amount,currency,status,category_id').eq('id', invoiceId).eq('user_id', user.id).maybeSingle()
  if (invoiceError) return json({ error: 'Impossibile leggere la fattura.' }, 500, origin)
  if (!invoice) return json({ error: 'Fattura non trovata.' }, 404, origin)
  const fingerprint = `invoice:${invoice.id}`
  let { data: transaction } = await admin.from('transactions').select('id').eq('user_id', user.id).eq('fingerprint', fingerprint).maybeSingle()
  if (!transaction) {
    const inserted = await admin.from('transactions').insert({ user_id: user.id, category_id: invoice.category_id, kind: 'expense', amount: Number(invoice.amount), currency: invoice.currency, description: `Pagamento ${invoice.supplier}`, occurred_on: new Date().toISOString().slice(0, 10), source: 'invoice', external_id: invoice.id, fingerprint, reconciled: true }).select('id').single()
    if (inserted.error && inserted.error.code !== '23505') return json({ error: 'Impossibile registrare la spesa.' }, 500, origin)
    transaction = inserted.data ?? (await admin.from('transactions').select('id').eq('user_id', user.id).eq('fingerprint', fingerprint).single()).data
  }
  if (!transaction?.id) return json({ error: 'Impossibile collegare il pagamento.' }, 500, origin)
  const { data: reconciliation } = await admin.from('reconciliations').select('id').eq('user_id', user.id).eq('transaction_id', transaction.id).maybeSingle()
  if (!reconciliation) {
    const linked = await admin.from('reconciliations').insert({ user_id: user.id, invoice_id: invoice.id, transaction_id: transaction.id, status: 'confirmed', confidence: 1, confirmed_at: new Date().toISOString() })
    if (linked.error && linked.error.code !== '23505') return json({ error: 'Impossibile riconciliare il pagamento.' }, 500, origin)
  }
  const updated = await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', invoice.id).eq('user_id', user.id)
  if (updated.error) return json({ error: 'Impossibile aggiornare la fattura.' }, 500, origin)
  if (invoice.status !== 'paid') await admin.from('audit_log').insert({ user_id: user.id, action: 'invoice_marked_paid_manually', entity_type: 'invoice', entity_id: invoice.id, metadata: { transaction_id: transaction.id, amount: Number(invoice.amount) } })
  return json({ invoice_id: invoice.id, transaction_id: transaction.id, status: 'paid' }, 200, origin)
})
