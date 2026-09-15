import webpush from 'npm:web-push@3.6.7'
import { adminClient, json } from '../_shared/gmail.ts'
import { syncRecentForUser } from '../_shared/gmail-sync.ts'

function romeNow() { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts().map(part => [part.type, part.value])); return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) } }
async function sendPush(userId: string, count: number) {
  const admin = adminClient(), { data: secrets } = await admin.from('soldi_system_secrets').select('name,secret_value').in('name', ['vapid_public', 'vapid_private'])
  const values = Object.fromEntries((secrets ?? []).map(item => [item.name, item.secret_value])); if (!values.vapid_public || !values.vapid_private) return
  webpush.setVapidDetails('mailto:notifications@klajdi.vercel.app', values.vapid_public, values.vapid_private)
  const { data: subscriptions } = await admin.from('push_subscriptions').select('*').eq('user_id', userId)
  const payload = JSON.stringify({ title: 'SOLDI', body: `${count} nuove email finanziarie negli ultimi 30 giorni.`, url: 'https://klajdi.vercel.app/?page=Email' })
  await Promise.all((subscriptions ?? []).map(async subscription => { try { await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload) } catch (error: any) { if ([404, 410].includes(error?.statusCode)) await admin.from('push_subscriptions').delete().eq('id', subscription.id) } }))
}
async function runScheduled(runDate: string) {
  const admin = adminClient(), { data: accounts } = await admin.from('email_accounts').select('user_id').eq('provider', 'gmail'), userIds = [...new Set((accounts ?? []).map(account => account.user_id))]
  let imported = 0, newUseful = 0
  for (const userId of userIds) { const result = await syncRecentForUser(userId, { restart: true, maxPages: 50 }); imported += result.imported; newUseful += result.newUseful; if (result.newUseful > 0) { await admin.from('notifications').insert({ user_id: userId, title: 'Nuove email finanziarie', body: `${result.newUseful} nuove email utili trovate negli ultimi 30 giorni.` }); await sendPush(userId, result.newUseful) } }
  await admin.from('scheduled_sync_runs').update({ completed_at: new Date().toISOString(), result: { imported, new_useful: newUseful, users: userIds.length } }).eq('run_on', runDate)
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
