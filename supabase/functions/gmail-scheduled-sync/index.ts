import webpush from 'npm:web-push@3.6.7'
import { adminClient, json } from '../_shared/gmail.ts'
import { syncRecentForUser } from '../_shared/gmail-sync.ts'
import { invoiceDeadlineReminder } from '../_shared/classification.js'
import { bankConsentReminder } from '../_shared/bank.js'
import { syncBanksForUser } from '../_shared/bank-sync.ts'

function romeNow() { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts().map(part => [part.type, part.value])); return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) } }
async function sendPush(userId: string, title: string, body: string, url = 'https://klajdi.vercel.app/?page=Email') {
  const admin = adminClient(), { data: secrets } = await admin.from('soldi_system_secrets').select('name,secret_value').in('name', ['vapid_public', 'vapid_private'])
  const values = Object.fromEntries((secrets ?? []).map(item => [item.name, item.secret_value])); if (!values.vapid_public || !values.vapid_private) return
  webpush.setVapidDetails('mailto:notifications@klajdi.vercel.app', values.vapid_public, values.vapid_private)
  const { data: subscriptions } = await admin.from('push_subscriptions').select('*').eq('user_id', userId)
  const payload = JSON.stringify({ title, body, url })
  await Promise.all((subscriptions ?? []).map(async subscription => { try { await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload) } catch (error: any) { if ([404, 410].includes(error?.statusCode)) await admin.from('push_subscriptions').delete().eq('id', subscription.id) } }))
}
async function sendInvoiceReminders(userId: string, runDate: string) {
  const admin = adminClient(), start = `${runDate}T00:00:00+00:00`, { data: invoices } = await admin.from('invoices').select('id,supplier,amount,currency,due_on,status').eq('user_id', userId).eq('status', 'to_pay').not('due_on', 'is', null)
  let sent = 0
  for (const invoice of invoices ?? []) {
    const reminder = invoiceDeadlineReminder(invoice, runDate)
    if (!reminder) continue
    const { data: existing } = await admin.from('notifications').select('id').eq('user_id', userId).eq('kind', 'invoice_deadline').eq('title', reminder.title).eq('body', reminder.body).gte('created_at', start).maybeSingle()
    if (existing) continue
    const inserted = await admin.from('notifications').insert({ user_id: userId, kind: 'invoice_deadline', title: reminder.title, body: reminder.body })
    if (inserted.error) continue
    await sendPush(userId, reminder.title, reminder.body, 'https://klajdi.vercel.app/?page=Scadenze'); sent += 1
  }
  return sent
}
async function sendBankExpiryReminders(userId: string, runDate: string) {
  const admin = adminClient(), { data: connections } = await admin.from('bank_connections').select('institution_name,status,valid_until').eq('user_id', userId).eq('provider', 'enablebanking').eq('status', 'linked').not('valid_until', 'is', null)
  let sent = 0
  for (const connection of connections ?? []) {
    const reminder = bankConsentReminder(connection, runDate)
    if (!reminder) continue
    const { data: existing } = await admin.from('notifications').select('id').eq('user_id', userId).eq('kind', 'bank_consent_expiry').eq('title', reminder.title).eq('body', reminder.body).maybeSingle()
    if (existing) continue
    const inserted = await admin.from('notifications').insert({ user_id: userId, kind: 'bank_consent_expiry', title: reminder.title, body: reminder.body })
    if (inserted.error) continue
    await sendPush(userId, reminder.title, reminder.body, 'https://klajdi.vercel.app/?page=Banca'); sent += 1
  }
  return sent
}
async function sendBudgetReminders(userId: string, runDate: string) {
  const admin = adminClient(), month = runDate.slice(0, 7), monthStart = `${month}-01T00:00:00+00:00`, [{ data: budgets }, { data: categories }, { data: transactions }] = await Promise.all([admin.from('budgets').select('category_id,monthly_limit').eq('user_id', userId), admin.from('categories').select('id,name').eq('user_id', userId), admin.from('transactions').select('category_id,amount').eq('user_id', userId).eq('kind', 'expense').eq('is_transfer', false).gte('occurred_on', `${month}-01`).lte('occurred_on', runDate)])
  let sent = 0
  for (const budget of budgets ?? []) {
    const spent = (transactions ?? []).filter(row => row.category_id === budget.category_id).reduce((sum, row) => sum + Number(row.amount), 0), limit = Number(budget.monthly_limit), percentage = limit ? spent / limit * 100 : 0
    if (percentage < 80) continue
    const name = categories?.find(category => category.id === budget.category_id)?.name ?? 'categoria', exceeded = percentage >= 100, title = exceeded ? `Budget ${name} superato` : `Budget ${name} quasi raggiunto`, body = exceeded ? `Hai superato il budget mensile di ${name}. Controlla le spese in SOLDI.` : `Hai utilizzato almeno l’80% del budget mensile di ${name}.`
    const { data: existing } = await admin.from('notifications').select('id').eq('user_id', userId).eq('kind', 'budget_warning').eq('title', title).gte('created_at', monthStart).maybeSingle()
    if (existing) continue
    const inserted = await admin.from('notifications').insert({ user_id: userId, kind: 'budget_warning', title, body }); if (inserted.error) continue
    await sendPush(userId, title, body, 'https://klajdi.vercel.app/?page=Statistiche'); sent += 1
  }
  return sent
}
async function runScheduled(runDate: string) {
  const admin = adminClient(), [{ data: accounts }, { data: bankConnections }, { data: budgets }] = await Promise.all([admin.from('email_accounts').select('user_id').eq('provider', 'gmail'), admin.from('bank_connections').select('user_id').eq('provider', 'enablebanking').eq('status', 'linked'), admin.from('budgets').select('user_id')]), emailUserIds = new Set((accounts ?? []).map(account => account.user_id)), userIds = [...new Set([...(accounts ?? []).map(account => account.user_id), ...(bankConnections ?? []).map(connection => connection.user_id), ...(budgets ?? []).map(budget => budget.user_id)])]
  let imported = 0, newUseful = 0
  let reminders = 0, bankReminders = 0, budgetReminders = 0, bankImported = 0, bankMatched = 0
  for (const userId of userIds) { if (emailUserIds.has(userId)) { const result = await syncRecentForUser(userId, { restart: true, maxPages: 50 }); imported += result.imported; newUseful += result.newUseful; if (result.newUseful > 0) { const body=`${result.newUseful} nuove email utili trovate questo mese.`; await admin.from('notifications').insert({ user_id: userId, title: 'Nuove email finanziarie', body }); await sendPush(userId, 'SOLDI', body) } } if ((bankConnections ?? []).some(connection => connection.user_id === userId)) { try { const bankResult = await syncBanksForUser(userId); bankImported += bankResult.imported; bankMatched += bankResult.matched; if (bankResult.matched > 0) { const body = bankResult.matched === 1 ? 'Una fattura è stata riconosciuta come pagata dal movimento bancario.' : `${bankResult.matched} fatture sono state riconosciute come pagate dai movimenti bancari.`; await admin.from('notifications').insert({ user_id: userId, kind: 'bank_reconciliation', title: 'Pagamento riconosciuto', body }); await sendPush(userId, 'Pagamento riconosciuto', body, 'https://klajdi.vercel.app/?page=Fatture') } if (bankResult.transferReview > 0) { const body = bankResult.transferReview === 1 ? 'Controlla un possibile trasferimento tra conti o una ricarica della tua carta.' : `Controlla ${bankResult.transferReview} possibili trasferimenti tra conti o ricariche.`; await admin.from('notifications').insert({ user_id: userId, kind: 'bank_transfer_review', title: 'Trasferimento da controllare', body }); await sendPush(userId, 'Trasferimento da controllare', body, 'https://klajdi.vercel.app/?page=Banca') } } catch { /* Un problema temporaneo della banca non blocca Gmail e promemoria. */ } } reminders += await sendInvoiceReminders(userId, runDate); bankReminders += await sendBankExpiryReminders(userId, runDate); budgetReminders += await sendBudgetReminders(userId, runDate) }
  await admin.from('scheduled_sync_runs').update({ completed_at: new Date().toISOString(), result: { imported, new_useful: newUseful, reminders, bank_reminders: bankReminders, budget_reminders: budgetReminders, bank_imported: bankImported, bank_matched: bankMatched, users: userIds.length } }).eq('run_on', runDate)
}
Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405)
  const admin = adminClient(), { data: secret } = await admin.from('soldi_system_secrets').select('secret_value').eq('name', 'cron_secret').single()
  if (!secret || req.headers.get('x-cron-secret') !== secret.secret_value) return json({ error: 'Non autorizzato.' }, 401)
  const local = romeNow(); if (local.hour !== 17) return json({ skipped: true, reason: 'outside_17_rome' }, 200)
  const { error } = await admin.from('scheduled_sync_runs').insert({ run_on: local.date })
  if (error?.code === '23505') return json({ skipped: true, reason: 'already_run' }, 200)
  if (error) return json({ error: 'Impossibile avviare il controllo programmato.' }, 500)
  EdgeRuntime.waitUntil(runScheduled(local.date)); return json({ accepted: true, run_on: local.date }, 202)
})
