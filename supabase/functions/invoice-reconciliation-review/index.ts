import { corsHeaders, currentUser, json, adminClient } from '../_shared/gmail.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  const body = await req.json().catch(() => ({})), reconciliationId = String(body.reconciliation_id ?? ''), decision = body.decision === 'confirm' ? 'confirm' : body.decision === 'reject' ? 'reject' : ''
  if (!/^[0-9a-f-]{36}$/i.test(reconciliationId) || !decision) return json({ error: 'Scelta non valida.' }, 400, origin)

  const admin = adminClient(), { data: link, error: linkError } = await admin.from('reconciliations').select('id,invoice_id,transaction_id,status').eq('id', reconciliationId).eq('user_id', user.id).maybeSingle()
  if (linkError) return json({ error: 'Impossibile leggere la corrispondenza.' }, 500, origin)
  if (!link || link.status !== 'suggested') return json({ error: 'Corrispondenza non più disponibile.' }, 409, origin)
  const [{ data: invoice }, { data: transaction }] = await Promise.all([
    admin.from('invoices').select('id,status,amount,supplier').eq('id', link.invoice_id).eq('user_id', user.id).maybeSingle(),
    admin.from('transactions').select('id,reconciled,amount,description').eq('id', link.transaction_id).eq('user_id', user.id).maybeSingle()
  ])
  if (!invoice || !transaction) return json({ error: 'Fattura o movimento non trovato.' }, 404, origin)

  if (decision === 'reject') {
    const rejected = await admin.from('reconciliations').update({ status: 'rejected', confirmed_at: null }).eq('id', link.id).eq('user_id', user.id).eq('status', 'suggested')
    if (rejected.error) return json({ error: 'Impossibile escludere la corrispondenza.' }, 500, origin)
    await admin.from('invoices').update({ status: 'to_pay', updated_at: new Date().toISOString() }).eq('id', invoice.id).eq('user_id', user.id).eq('status', 'to_review')
    await admin.from('audit_log').insert({ user_id: user.id, action: 'invoice_bank_match_rejected', entity_type: 'invoice', entity_id: invoice.id, metadata: { transaction_id: transaction.id } })
    return json({ result: 'rejected', invoice_status: invoice.status === 'paid' ? 'paid' : 'to_pay' }, 200, origin)
  }

  if (invoice.status === 'paid' || transaction.reconciled) return json({ error: 'La fattura o il movimento risultano già riconciliati.' }, 409, origin)
  const confirmed = await admin.from('reconciliations').update({ status: 'confirmed', confidence: 1, confirmed_at: new Date().toISOString() }).eq('id', link.id).eq('user_id', user.id).eq('status', 'suggested')
  if (confirmed.error?.code === '23505') return json({ error: 'Questa fattura o questo movimento sono già collegati a un altro pagamento.' }, 409, origin)
  if (confirmed.error) return json({ error: 'Impossibile confermare il pagamento.' }, 500, origin)
  const transactionUpdate = await admin.from('transactions').update({ reconciled: true, updated_at: new Date().toISOString() }).eq('id', transaction.id).eq('user_id', user.id)
  const invoiceUpdate = await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', invoice.id).eq('user_id', user.id)
  if (transactionUpdate.error || invoiceUpdate.error) return json({ error: 'Pagamento collegato, ma stato non aggiornato.' }, 500, origin)
  await admin.from('audit_log').insert({ user_id: user.id, action: 'invoice_bank_match_confirmed_by_user', entity_type: 'invoice', entity_id: invoice.id, metadata: { transaction_id: transaction.id, amount: Number(invoice.amount) } })
  return json({ result: 'confirmed', invoice_status: 'paid', transaction_id: transaction.id }, 200, origin)
})
