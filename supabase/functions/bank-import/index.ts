import { corsHeaders, currentUser, json, adminClient, sha256 } from '../_shared/gmail.ts'
import { bankCategoryName, bankMatchConfidence, cleanBankText } from '../_shared/bank.js'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  const body = await req.json().catch(() => ({})), rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : []
  if (!rows.length) return json({ error: 'Nessun movimento da importare.' }, 400, origin)
  const admin = adminClient()
  const categories = (await admin.from('categories').select('id,name,kind').eq('user_id', user.id)).data ?? []
  const { data: invoices, error: invoiceError } = await admin.from('invoices').select('id,supplier,amount,currency,iuv,due_on,issued_on,status,category_id').eq('user_id', user.id).in('status', ['to_pay', 'paid'])
  if (invoiceError) return json({ error: 'Impossibile leggere le fatture.' }, 500, origin)
  const invoiceIds = (invoices ?? []).map(invoice => invoice.id)
  const reconciliations = invoiceIds.length ? (await admin.from('reconciliations').select('invoice_id,transaction_id,status').eq('user_id', user.id).in('invoice_id', invoiceIds)).data ?? [] : []
  let imported = 0, duplicates = 0, matched = 0, review = 0
  for (const item of rows) {
    const occurredOn = String(item.occurred_on ?? ''), description = String(item.description ?? '').trim().slice(0, 300), amount = Number(item.amount), kind = item.kind === 'income' ? 'income' : 'expense'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || !description || !Number.isFinite(amount) || amount <= 0) continue
    const row = { occurred_on: occurredOn, description, amount, kind }
    const fingerprint = `bank:${await sha256(`${occurredOn}|${kind}|${amount.toFixed(2)}|${cleanBankText(description)}`)}`
    const existing = await admin.from('transactions').select('id').eq('user_id', user.id).eq('fingerprint', fingerprint).maybeSingle()
    if (existing.data) { duplicates++; continue }
    const exact = (invoices ?? []).filter(invoice => bankMatchConfidence(invoice, row) >= 0.8)
    const strong = exact.filter(invoice => bankMatchConfidence(invoice, row) === 1)
    const candidate = strong.length === 1 ? strong[0] : exact.length === 1 ? exact[0] : null
    const confidence = strong.length === 1 ? 1 : candidate ? 0.8 : 0
    const prior = candidate ? reconciliations.find(link => link.invoice_id === candidate.id && link.status === 'confirmed') : null
    if (prior && confidence === 1) { duplicates++; continue }
    const categoryName = bankCategoryName(row), categoryId = categories.find(category => category.name === categoryName && (category.kind === kind || category.kind === 'both'))?.id ?? null
    const inserted = await admin.from('transactions').insert({ user_id: user.id, category_id: candidate?.category_id ?? categoryId, kind, amount, currency: 'EUR', description, occurred_on: occurredOn, source: 'bank', external_id: fingerprint.slice(5), fingerprint, reconciled: confidence === 1 }).select('id').single()
    if (inserted.error) { if (inserted.error.code === '23505') { duplicates++; continue } return json({ error: 'Importazione interrotta: nessun dato è stato duplicato.' }, 500, origin) }
    imported++
    if (candidate) {
      const status = confidence === 1 ? 'confirmed' : 'suggested'
      const linked = await admin.from('reconciliations').insert({ user_id: user.id, invoice_id: candidate.id, transaction_id: inserted.data.id, status, confidence, confirmed_at: confidence === 1 ? new Date().toISOString() : null })
      if (!linked.error && confidence === 1) { await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', candidate.id).eq('user_id', user.id); matched++ } else if (!linked.error) review++
    }
  }
  await admin.from('audit_log').insert({ user_id: user.id, action: 'bank_csv_imported', entity_type: 'transactions', metadata: { imported, duplicates, matched, review } })
  return json({ imported, duplicates, matched, review }, 200, origin)
})
