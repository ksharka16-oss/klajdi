import { adminClient, clientId, clientSecret, corsHeaders, currentUser, decryptToken, encryptToken, json } from '../_shared/gmail.ts'
import { classifyEmail } from '../_shared/classification.js'

function header(message: any, name: string) {
  return message.payload?.headers?.find((item: any) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function attachmentNames(part: any): string[] {
  const own = part?.filename ? [part.filename] : []
  return own.concat((part?.parts ?? []).flatMap(attachmentNames))
}

async function refreshToken(refresh: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error('Ricollega questo account Gmail.')
  return data
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)

  const admin = adminClient()
  const { data: accounts, error: accountsError } = await admin.from('email_accounts').select('id,sync_cursor').eq('user_id', user.id).eq('provider', 'gmail')
  if (accountsError) return json({ error: 'Impossibile leggere gli account Gmail.' }, 500, origin)
  if (!accounts?.length) return json({ error: 'Collega prima un account Gmail.' }, 400, origin)

  let imported = 0
  let remaining = false
  for (const account of accounts) {
    const { data: credential } = await admin.from('gmail_credentials').select('*').eq('email_account_id', account.id).eq('user_id', user.id).maybeSingle()
    if (!credential) continue
    let accessToken = await decryptToken(credential.access_token_encrypted)
    if (!credential.token_expires_at || new Date(credential.token_expires_at).getTime() < Date.now() + 60000) {
      if (!credential.refresh_token_encrypted) return json({ error: 'Ricollega questo account Gmail.' }, 401, origin)
      const refreshed = await refreshToken(await decryptToken(credential.refresh_token_encrypted))
      accessToken = refreshed.access_token
      await admin.from('gmail_credentials').update({
        access_token_encrypted: await encryptToken(accessToken),
        token_expires_at: new Date(Date.now() + Number(refreshed.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('email_account_id', account.id)
    }

    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
    listUrl.searchParams.set('maxResults', '20')
    if (account.sync_cursor) listUrl.searchParams.set('pageToken', account.sync_cursor)
    const listResponse = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    const list = await listResponse.json()
    if (!listResponse.ok) return json({ error: 'Gmail non è raggiungibile o i permessi sono scaduti.' }, 502, origin)

    for (const item of list.messages ?? []) {
      try {
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } })
        const message = await response.json()
        if (!response.ok) throw new Error('Lettura messaggio non riuscita')
        const files = attachmentNames(message.payload)
        const row = {
          user_id: user.id,
          email_account_id: account.id,
          provider_message_id: message.id,
          thread_id: message.threadId ?? null,
          sender: header(message, 'From') || null,
          subject: header(message, 'Subject') || '(senza oggetto)',
          received_at: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
          classification: classifyEmail(header(message, 'Subject'), header(message, 'From'), message.snippet ?? '', files),
          processing_state: 'complete',
          last_error: null,
        }
        const { error } = await admin.from('emails').upsert(row, { onConflict: 'email_account_id,provider_message_id' })
        if (error) throw error
        imported += 1
      } catch (error) {
        const existing = await admin.from('emails').select('retry_count').eq('email_account_id', account.id).eq('provider_message_id', item.id).maybeSingle()
        await admin.from('emails').upsert({
          user_id: user.id,
          email_account_id: account.id,
          provider_message_id: item.id,
          classification: 'normal',
          processing_state: 'retry',
          retry_count: Number(existing.data?.retry_count ?? 0) + 1,
          last_error: error instanceof Error ? error.message : 'Errore sconosciuto',
        }, { onConflict: 'email_account_id,provider_message_id' })
      }
    }
    remaining ||= Boolean(list.nextPageToken)
    await admin.from('email_accounts').update({ sync_cursor: list.nextPageToken ?? null, last_synced_at: new Date().toISOString() }).eq('id', account.id).eq('user_id', user.id)
  }
  return json({ imported, has_more: remaining }, 200, origin)
})
