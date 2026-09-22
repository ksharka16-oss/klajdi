import { corsHeaders, currentUser, json, adminClient } from '../_shared/gmail.ts'
import { bankMatchConfidence } from '../_shared/bank.js'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  const body = await req.json().catch(() => ({})), invoiceId = String(body.invoice_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json({ error: 'Fattura non valida.' }, 400, origin)

  const admin = adminClient()
  const { data: invoice, error: invoiceError } = await admin.from('invoices').select('id,user_id,supplier,amount,currency,iuv,invoice_number,due_on,issued_on,status').eq('id', invoiceId).eq('user_id', user.id).maybeSingle()
  if (invoiceError) return json({ error: 'Impossibile leggere la fattura.' }, 500, origin)
  if (!invoice) return json({ error: 'Fattura non trovata.' }, 404, origin)
  if (invoice.status === 'paid') return json({ invoice_id: invoice.id, status: 'paid', result: 'already_paid' }, 200, origin)

  const { data: transactions, error: transactionError } = await admin.from('transactions').select('id,kind,amount,currency,description,occurred_on,is_transfer,reconciled,source').eq('user_id', user.id).eq('kind', 'expense').eq('source', 'bank').eq('is_transfer', false).eq('reconciled', false).limit(1000)
  if (transactionError) return json({ error: 'Impossibile controllare i movimenti bancari.' }, 500, origin)
  const rows = transactions ?? [], transactionIds = rows.map(row => row.id)
  const linked = transactionIds.length ? (await admin.from('reconciliations').select('transaction_id').eq('user_id', user.id).in('transaction_id', transactionIds)).data ?? [] : []
  const linkedIds = new Set(linked.map(item => item.transaction_id))
  const candidates = rows.filter(row => !linkedIds.has(row.id)).map(row => ({ row, confidence: bankMatchConfidence(invoice, row) })).filter(item => item.confidence >= .8)
  const strong = candidates.filter(item => item.confidence === 1)

  if (strong.length === 1) {
    const match = strong[0]
    const inserted = await admin.from('reconciliations').insert({ user_id: user.id, invoice_id: invoice.id, transaction_id: match.row.id, status: 'confirmed', confidence: 1, confirmed_at: new Date().toISOString() })
    if (inserted.error?.code === '23505') return json({ invoice_id: invoice.id, status: 'to_review', result: 'conflict' }, 200, origin)
    if (inserted.error) return json({ error: 'Impossibile collegare il pagamento.' }, 500, origin)
    const transactionUpdate = await admin.from('transactions').update({ reconciled: true }).eq('id', match.row.id).eq('user_id', user.id)
    const invoiceUpdate = await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', invoice.id).eq('user_id', user.id)
    if (transactionUpdate.error || invoiceUpdate.error) return json({ error: 'Il collegamento è stato registrato, ma lo stato non è stato aggiornato.' }, 500, origin)
    await admin.from('audit_log').insert({ user_id: user.id, action: 'invoice_matched_existing_bank_transaction', entity_type: 'invoice', entity_id: invoice.id, metadata: { transaction_id: match.row.id, confidence: 1, amount: Number(invoice.amount) } })
    return json({ invoice_id: invoice.id, transaction_id: match.row.id, status: 'paid', result: 'confirmed' }, 200, origin)
  }

  if (strong.length === 0 && candidates.length === 1) {
    const match = candidates[0]
    const inserted = await admin.from('reconciliations').insert({ user_id: user.id, invoice_id: invoice.id, transaction_id: match.row.id, status: 'suggested', confidence: match.confidence })
    if (inserted.error?.code === '23505') return json({ invoice_id: invoice.id, status: 'to_review', result: 'conflict' }, 200, origin)
    if (inserted.error) return json({ error: 'Impossibile registrare il controllo.' }, 500, origin)
    const invoiceUpdate = await admin.from('invoices').update({ status: 'to_review', updated_at: new Date().toISOString() }).eq('id', invoice.id).eq('user_id', user.id)
    if (invoiceUpdate.error) return json({ error: 'Il controllo è stato registrato, ma lo stato non è stato aggiornato.' }, 500, origin)
    return json({ invoice_id: invoice.id, transaction_id: match.row.id, status: 'to_review', result: 'suggested' }, 200, origin)
  }

  return json({ invoice_id: invoice.id, status: invoice.status, result: strong.length > 1 || candidates.length > 1 ? 'ambiguous' : 'none' }, 200, origin)
})
