import { adminClient, sha256 } from './gmail.ts'
import { bankCategoryName, bankMatchConfidence, cleanBankText, merchantRuleKey, ownTransferKey, ownTransferPairs, possibleOwnTransfer } from './bank.js'
import { accountBalance, bankDescription, bankSyncRange, eb, isBookedTransaction, isExpiredBankSession, isTransactionInRange, transactionAmount, transactionContinuation, transactionDate, transactionRows } from './enablebanking.ts'

async function transactionPages(accountId: string, query: string) {
  const firstPage = await eb(`/accounts/${accountId}/transactions?${query}`), pages = [firstPage], seenContinuations = new Set<string>()
  let continuation = transactionContinuation(firstPage)
  for (let page = 1; continuation && page < 100 && !seenContinuations.has(continuation); page++) { seenContinuations.add(continuation); const next = await eb(`/accounts/${accountId}/transactions?continuation_key=${encodeURIComponent(continuation)}`); pages.push(next); continuation = transactionContinuation(next) }
  return pages
}

export async function syncBanksForUser(userId: string) {
  const admin = adminClient(), linkedConnections = (await admin.from('bank_connections').select('id').eq('user_id', userId).eq('provider', 'enablebanking').eq('status', 'linked')).data ?? [], linkedIds = linkedConnections.map(connection => connection.id)
  const profile = (await admin.from('profiles').select('transactions_start_on,timezone').eq('id', userId).maybeSingle()).data
  const syncRange = bankSyncRange(profile?.transactions_start_on, profile?.timezone || 'Europe/Rome')
  const accounts = linkedIds.length ? (await admin.from('accounts').select('*').eq('user_id', userId).eq('external_provider', 'enablebanking').in('bank_connection_id', linkedIds)).data ?? [] : [], invoices = (await admin.from('invoices').select('id,supplier,amount,currency,iuv,invoice_number,due_on,issued_on,status,category_id').eq('user_id', userId).in('status', ['to_pay', 'to_review'])).data ?? [], categories = (await admin.from('categories').select('id,name,kind').eq('user_id', userId)).data ?? [], rules = (await admin.from('learning_rules').select('rule_type,pattern,outcome').eq('user_id', userId).in('rule_type', ['own_transfer','merchant_category']).gte('confidence', .9)).data ?? []
  const knownTransferKeys = rules.filter(rule => rule.outcome?.is_transfer === true).map(rule => rule.pattern?.key).filter(Boolean)
  const categoryId = (row: any) => { const learned = rules.find(rule => rule.rule_type === 'merchant_category' && rule.pattern?.key === merchantRuleKey(row.description))?.outcome?.category_id; if (learned && categories.some(category => category.id === learned && (category.kind === row.kind || category.kind === 'both'))) return learned; const name = bankCategoryName(row); return categories.find(category => category.name === name && (category.kind === row.kind || category.kind === 'both'))?.id ?? null }
  const invoiceIds = invoices.map(invoice => invoice.id), links = invoiceIds.length ? (await admin.from('reconciliations').select('invoice_id,status').eq('user_id', userId).in('invoice_id', invoiceIds)).data ?? [] : []
  const confirmedInvoiceIds = new Set(links.filter(link => link.status === 'confirmed').map(link => link.invoice_id)), suggestedInvoiceIds = new Set(links.filter(link => link.status === 'suggested').map(link => link.invoice_id))
  let imported = 0, duplicates = 0, matched = 0, review = 0, transferReview = 0, transfers = 0
  const accountResults: Array<{ institution: string; last4: string; received: number; booked: number; pages: number; fallback: boolean; error?: string }> = [], failedConnections = new Set<string>()
  const matchedInvoices: Array<{ supplier: string; amount: number }> = []
  for (const account of accounts) {
    const connectionId = String(account.bank_connection_id ?? ''), label = { institution: String(account.institution ?? 'Banca'), last4: String(account.iban_last4 ?? '') }
    if (connectionId && failedConnections.has(connectionId)) { accountResults.push({ ...label, received: 0, booked: 0, pages: 0, fallback: false, error: 'Autorizzazione bancaria scaduta.' }); continue }
    try {
    const id = encodeURIComponent(account.external_account_id), { dateFrom, dateTo } = syncRange
    const [initialPages, balances] = await Promise.all([transactionPages(id, `date_from=${dateFrom}&date_to=${dateTo}`), eb(`/accounts/${id}/balances`)]), balance = accountBalance(balances)
    const accountUpdate: any = { currency: balance.currency, updated_at: new Date().toISOString() }; if (balance.amount != null) accountUpdate.current_balance = balance.amount
    await admin.from('accounts').update(accountUpdate).eq('id', account.id).eq('user_id', userId)
    let pages = initialPages, receivedRows = pages.flatMap(transactionRows), fallback = false
    if (!receivedRows.length) { pages = await transactionPages(id, `date_from=${dateFrom}&date_to=${dateTo}&strategy=longest`); receivedRows = pages.flatMap(transactionRows); fallback = true }
    const bookedRows = receivedRows.filter(isBookedTransaction).filter(row => isTransactionInRange(row, dateFrom, dateTo))
    accountResults.push({ ...label, received: receivedRows.length, booked: bookedRows.length, pages: pages.length, fallback })
    for (const source of bookedRows) {
      const parsed = transactionAmount(source), signed = parsed.amount, amount = Math.abs(signed), indicator = String(source.credit_debit_indicator ?? source.creditDebitIndicator ?? '').toUpperCase(), kind = indicator === 'DBIT' || indicator === 'DEBIT' || signed < 0 ? 'expense' : 'income', occurredOn = transactionDate(source), description = bankDescription(source)
      if (!occurredOn || !Number.isFinite(amount) || amount <= 0) continue
      const fingerprint = `bank:${await sha256(`${occurredOn}|${kind}|${amount.toFixed(2)}|${cleanBankText(description)}`)}`
      const existing = await admin.from('transactions').select('id').eq('user_id', userId).eq('fingerprint', fingerprint).maybeSingle()
      if (existing.data) { duplicates++; continue }
      const row = { occurred_on: occurredOn, description, amount, kind }, learnedTransfer = possibleOwnTransfer(row, knownTransferKeys) && knownTransferKeys.includes(ownTransferKey(description)), scored = learnedTransfer ? [] : invoices.filter(invoice => !confirmedInvoiceIds.has(invoice.id)).map(invoice => ({ invoice, confidence: bankMatchConfidence(invoice, row) })).filter(item => item.confidence >= .8), strong = scored.filter(item => item.confidence === 1), weak = scored.filter(item => item.confidence === .8 && !suggestedInvoiceIds.has(item.invoice.id)), candidate = strong.length === 1 ? strong[0].invoice : strong.length === 0 && weak.length === 1 ? weak[0].invoice : null, confidence = strong.length === 1 ? 1 : candidate ? .8 : 0
      const inserted = await admin.from('transactions').insert({ user_id: userId, account_id: account.id, category_id: learnedTransfer ? null : candidate?.category_id ?? categoryId(row), kind, amount, currency: parsed.currency || account.currency || 'EUR', description, occurred_on: occurredOn, source: 'bank', external_id: source.transaction_id || source.transactionId || source.entry_reference || fingerprint.slice(5), fingerprint, reconciled: false, is_transfer: learnedTransfer, transfer_status: learnedTransfer ? 'confirmed' : null }).select('id').single()
      if (inserted.error) { if (inserted.error.code === '23505') { duplicates++; continue } throw inserted.error } imported++
      if (candidate) { const linked = await admin.from('reconciliations').insert({ user_id: userId, invoice_id: candidate.id, transaction_id: inserted.data.id, status: confidence === 1 ? 'confirmed' : 'suggested', confidence, confirmed_at: confidence === 1 ? new Date().toISOString() : null }); if (!linked.error && confidence === 1) { await admin.from('transactions').update({ reconciled: true }).eq('id', inserted.data.id).eq('user_id', userId); await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', candidate.id).eq('user_id', userId); confirmedInvoiceIds.add(candidate.id); matched++; matchedInvoices.push({ supplier: candidate.supplier, amount: Number(candidate.amount) }) } else if (!linked.error) { suggestedInvoiceIds.add(candidate.id); review++ } }
    }
    } catch (error) {
      const expired = isExpiredBankSession(error), message = expired ? 'Autorizzazione bancaria scaduta.' : String(error?.message ?? 'Aggiornamento bancario non riuscito.')
      accountResults.push({ ...label, received: 0, booked: 0, pages: 0, fallback: false, error: message })
      if (expired && connectionId) { failedConnections.add(connectionId); await admin.from('bank_connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', connectionId).eq('user_id', userId).eq('status', 'linked') }
    }
  }
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10), { data: recent } = await admin.from('transactions').select('id,account_id,kind,amount,occurred_on,description,reconciled,is_transfer,transfer_status').eq('user_id', userId).eq('source', 'bank').gte('occurred_on', cutoff)
  const pairedIds = new Set<string>()
  for (const pair of ownTransferPairs(recent ?? [])) { const group = crypto.randomUUID(), updated = await admin.from('transactions').update({ is_transfer: true, transfer_status: 'confirmed', transfer_group_id: group, category_id: null, updated_at: new Date().toISOString() }).eq('user_id', userId).in('id', pair); if (!updated.error) { transfers += 1; pair.forEach(id => pairedIds.add(id)) } }
  for (const transaction of recent ?? []) { if (!pairedIds.has(transaction.id) && !transaction.is_transfer && !transaction.transfer_status && possibleOwnTransfer(transaction, knownTransferKeys)) { const updated = await admin.from('transactions').update({ transfer_status: 'suggested', updated_at: new Date().toISOString() }).eq('id', transaction.id).eq('user_id', userId).is('transfer_status', null); if (!updated.error) transferReview += 1 } }
  const { data: uncategorized } = await admin.from('transactions').select('id,kind,description,is_transfer').eq('user_id', userId).eq('source', 'bank').is('category_id', null).eq('is_transfer', false).limit(500)
  for (const transaction of uncategorized ?? []) { const inferred = categoryId(transaction); if (inferred) await admin.from('transactions').update({ category_id: inferred, updated_at: new Date().toISOString() }).eq('id', transaction.id).eq('user_id', userId).is('category_id', null) }
  await admin.from('bank_connections').update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', 'enablebanking').eq('status', 'linked')
  return { imported, duplicates, matched, review, transferReview, transfers, accounts: accounts.length, accountResults, matchedInvoices }
}
