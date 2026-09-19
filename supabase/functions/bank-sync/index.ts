import { corsHeaders, currentUser, json, adminClient, sha256 } from '../_shared/gmail.ts'
import { bankMatchConfidence, cleanBankText } from '../_shared/bank.js'
import { accountBalance, bankDescription, eb, transactionAmount, transactionRows } from '../_shared/enablebanking.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin'); if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const admin = adminClient(), accounts = (await admin.from('accounts').select('*').eq('user_id', user.id).eq('external_provider', 'enablebanking')).data ?? [], invoices = (await admin.from('invoices').select('id,supplier,amount,currency,iuv,due_on,issued_on,status,category_id').eq('user_id', user.id).in('status', ['to_pay', 'paid'])).data ?? []
    const invoiceIds = invoices.map(invoice => invoice.id), links = invoiceIds.length ? (await admin.from('reconciliations').select('invoice_id,status').eq('user_id', user.id).in('invoice_id', invoiceIds)).data ?? [] : []
    let imported = 0, duplicates = 0, matched = 0, review = 0
    for (const account of accounts) {
      const id = encodeURIComponent(account.external_account_id), dateTo = new Date().toISOString().slice(0, 10), dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const [firstPage, balances] = await Promise.all([eb(`/accounts/${id}/transactions?date_from=${dateFrom}&date_to=${dateTo}&transaction_status=BOOK`), eb(`/accounts/${id}/balances`)]), balance = accountBalance(balances)
      const accountUpdate: any = { currency: balance.currency, updated_at: new Date().toISOString() }; if (balance.amount != null) accountUpdate.current_balance = balance.amount
      await admin.from('accounts').update(accountUpdate).eq('id', account.id).eq('user_id', user.id)
      const pages = [firstPage]; let continuation = firstPage.continuation_key
      for (let page = 1; continuation && page < 20; page++) { const next = await eb(`/accounts/${id}/transactions?continuation_key=${encodeURIComponent(continuation)}`); pages.push(next); continuation = next.continuation_key }
      for (const source of pages.flatMap(transactionRows)) {
        const parsed = transactionAmount(source), signed = parsed.amount, amount = Math.abs(signed), indicator = String(source.credit_debit_indicator ?? source.creditDebitIndicator ?? '').toUpperCase(), kind = indicator === 'DBIT' || indicator === 'DEBIT' || signed < 0 ? 'expense' : 'income', occurredOn = source.booking_date || source.bookingDate || source.value_date || source.valueDate, description = bankDescription(source)
        if (!occurredOn || !Number.isFinite(amount) || amount <= 0) continue
        const fingerprint = `bank:${await sha256(`${occurredOn}|${kind}|${amount.toFixed(2)}|${cleanBankText(description)}`)}`
        const existing = await admin.from('transactions').select('id').eq('user_id', user.id).eq('fingerprint', fingerprint).maybeSingle()
        if (existing.data) { duplicates++; continue }
        const row = { occurred_on: occurredOn, description, amount, kind }, exact = invoices.filter(invoice => bankMatchConfidence(invoice, row) >= .8), strong = exact.filter(invoice => bankMatchConfidence(invoice, row) === 1), candidate = strong.length === 1 ? strong[0] : exact.length === 1 ? exact[0] : null, confidence = strong.length === 1 ? 1 : candidate ? .8 : 0
        if (candidate && confidence === 1 && links.some(link => link.invoice_id === candidate.id && link.status === 'confirmed')) { duplicates++; continue }
        const inserted = await admin.from('transactions').insert({ user_id: user.id, account_id: account.id, category_id: candidate?.category_id ?? null, kind, amount, currency: parsed.currency || account.currency || 'EUR', description, occurred_on: occurredOn, source: 'bank', external_id: source.transaction_id || source.transactionId || source.entry_reference || fingerprint.slice(5), fingerprint, reconciled: confidence === 1 }).select('id').single()
        if (inserted.error) { if (inserted.error.code === '23505') { duplicates++; continue } throw inserted.error } imported++
        if (candidate) { const linked = await admin.from('reconciliations').insert({ user_id: user.id, invoice_id: candidate.id, transaction_id: inserted.data.id, status: confidence === 1 ? 'confirmed' : 'suggested', confidence, confirmed_at: confidence === 1 ? new Date().toISOString() : null }); if (!linked.error && confidence === 1) { await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', candidate.id).eq('user_id', user.id); matched++ } else if (!linked.error) review++ }
      }
    }
    await admin.from('bank_connections').update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('provider', 'enablebanking').eq('status', 'linked')
    return json({ imported, duplicates, matched, review, accounts: accounts.length }, 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
