import webpush from 'npm:web-push@3.6.7'
import { adminClient, currentUser, json } from '../_shared/gmail.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': origin ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)

  const admin = adminClient()
  const [{ data: secrets }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
    admin.from('soldi_system_secrets').select('name,secret_value').in('name', ['vapid_public', 'vapid_private']),
    admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', user.id),
  ])
  if (subscriptionError) return json({ error: 'Impossibile leggere i dispositivi registrati.' }, 500, origin)
  if (!subscriptions?.length) return json({ error: 'Nessun telefono registrato per le notifiche.' }, 404, origin)

  const values = Object.fromEntries((secrets ?? []).map(item => [item.name, item.secret_value]))
  if (!values.vapid_public || !values.vapid_private) return json({ error: 'Notifiche non configurate.' }, 500, origin)
  webpush.setVapidDetails('mailto:notifications@klajdi.vercel.app', values.vapid_public, values.vapid_private)

  const payload = JSON.stringify({ title: 'SOLDI', body: 'Notifiche attive: questo telefono è collegato correttamente.', url: 'https://klajdi.vercel.app/?page=Home' })
  let sent = 0
  await Promise.all(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload)
      sent += 1
    } catch (error: any) {
      if ([404, 410].includes(error?.statusCode)) await admin.from('push_subscriptions').delete().eq('id', subscription.id).eq('user_id', user.id)
    }
  }))
  return sent ? json({ sent }, 200, origin) : json({ error: 'La notifica non è arrivata al dispositivo. Riattiva le notifiche e riprova.' }, 502, origin)
})
