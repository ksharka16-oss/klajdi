import { adminClient, clientId, clientSecret, decryptToken, encryptToken } from './gmail.ts'
import { classifyEmail, gmailRollingRange } from './classification.js'

function header(message: any, name: string) { return message.payload?.headers?.find((item: any) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? '' }
function attachmentNames(part: any): string[] { return (part?.filename ? [part.filename] : []).concat((part?.parts ?? []).flatMap(attachmentNames)) }
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
async function googleFetch(url: string | URL, accessToken: string) {
  let response: Response | null = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (![429, 500, 502, 503, 504].includes(response.status)) return response
    await pause(500 * (2 ** attempt))
  }
  return response!
}

async function refreshToken(refresh: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }) })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error('Ricollega questo account Gmail.')
  return data
}

async function accessTokenFor(accountId: string, userId: string) {
  const admin = adminClient()
  const { data: credential } = await admin.from('gmail_credentials').select('*').eq('email_account_id', accountId).eq('user_id', userId).maybeSingle()
  if (!credential) return null
  let accessToken = await decryptToken(credential.access_token_encrypted)
  if (!credential.token_expires_at || new Date(credential.token_expires_at).getTime() < Date.now() + 60000) {
    if (!credential.refresh_token_encrypted) throw new Error('Ricollega questo account Gmail.')
    const refreshed = await refreshToken(await decryptToken(credential.refresh_token_encrypted))
    accessToken = refreshed.access_token
    await admin.from('gmail_credentials').update({ access_token_encrypted: await encryptToken(accessToken), token_expires_at: new Date(Date.now() + Number(refreshed.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('email_account_id', accountId)
  }
  return accessToken
}

async function syncAccountPage(account: any, userId: string, restart: boolean) {
  const admin = adminClient(), rollingRange = gmailRollingRange()
  let cursor: { window?: string; pageToken?: string | null; complete?: boolean } = {}
  try { cursor = JSON.parse(account.sync_cursor ?? '{}') } catch { cursor = {} }
  if (restart || cursor.window !== rollingRange.window) cursor = { window: rollingRange.window, pageToken: null, complete: false }
  if (cursor.complete) return { imported: 0, newUseful: 0, hasMore: false }
  const accessToken = await accessTokenFor(account.id, userId)
  if (!accessToken) return { imported: 0, newUseful: 0, hasMore: false }
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  listUrl.searchParams.set('maxResults', '20'); listUrl.searchParams.set('q', rollingRange.query)
  if (cursor.pageToken) listUrl.searchParams.set('pageToken', cursor.pageToken)
  const listResponse = await googleFetch(listUrl, accessToken), list = await listResponse.json()
  if (!listResponse.ok) throw new Error(listResponse.status === 429 ? 'Gmail è temporaneamente occupato: il controllo riprenderà automaticamente.' : 'Gmail non è raggiungibile o i permessi sono scaduti.')
  const { data: retryRows } = await admin.from('emails').select('provider_message_id').eq('email_account_id', account.id).eq('processing_state', 'retry').limit(20)
  const messageIds = [...new Set([...(retryRows ?? []).map(row => row.provider_message_id), ...(list.messages ?? []).map((item: any) => item.id)])]
  const readMessage = async (messageId: string) => {
    try {
      const { data: existing } = await admin.from('emails').select('id').eq('email_account_id', account.id).eq('provider_message_id', messageId).maybeSingle()
      const response = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, accessToken), message = await response.json()
      if (!response.ok) throw new Error('Lettura messaggio non riuscita')
      const messageClassification = classifyEmail(header(message, 'Subject'), header(message, 'From'), message.snippet ?? '', attachmentNames(message.payload))
      const { error } = await admin.from('emails').upsert({ user_id: userId, email_account_id: account.id, provider_message_id: message.id, thread_id: message.threadId ?? null, sender: header(message, 'From') || null, subject: header(message, 'Subject') || '(senza oggetto)', received_at: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null, classification: messageClassification, processing_state: 'complete', last_error: null }, { onConflict: 'email_account_id,provider_message_id' })
      if (error) throw error
      return { imported: 1, newUseful: !existing && !['normal', 'ignore'].includes(messageClassification) ? 1 : 0 }
    } catch (error) {
      const existing = await admin.from('emails').select('retry_count').eq('email_account_id', account.id).eq('provider_message_id', messageId).maybeSingle()
      await admin.from('emails').upsert({ user_id: userId, email_account_id: account.id, provider_message_id: messageId, classification: 'normal', processing_state: 'retry', retry_count: Number(existing.data?.retry_count ?? 0) + 1, last_error: error instanceof Error ? error.message : 'Errore sconosciuto' }, { onConflict: 'email_account_id,provider_message_id' })
      return { imported: 0, newUseful: 0 }
    }
  }
  const results = []
  for (let offset = 0; offset < messageIds.length; offset += 5) results.push(...await Promise.all(messageIds.slice(offset, offset + 5).map(readMessage)))
  await admin.from('email_accounts').update({ sync_cursor: JSON.stringify({ window: rollingRange.window, pageToken: list.nextPageToken ?? null, complete: !list.nextPageToken }), last_synced_at: new Date().toISOString() }).eq('id', account.id).eq('user_id', userId)
  return { imported: results.reduce((n, value) => n + value.imported, 0), newUseful: results.reduce((n, value) => n + value.newUseful, 0), hasMore: Boolean(list.nextPageToken) }
}

export async function syncRecentForUser(userId: string, options: { restart?: boolean; maxPages?: number } = {}) {
  const admin = adminClient(); let imported = 0, newUseful = 0, hasMore = true, page = 0, accountCount = 0
  while (hasMore && page < (options.maxPages ?? 1)) {
    const { data: accounts, error } = await admin.from('email_accounts').select('id,sync_cursor').eq('user_id', userId).eq('provider', 'gmail')
    if (error) throw error
    accountCount = accounts?.length ?? 0
    if (!accountCount) return { imported, newUseful, hasMore: false, accounts: 0 }
    const results = await Promise.all(accounts!.map(account => syncAccountPage(account, userId, Boolean(options.restart && page === 0))))
    imported += results.reduce((n, value) => n + value.imported, 0); newUseful += results.reduce((n, value) => n + value.newUseful, 0); hasMore = results.some(value => value.hasMore); page += 1
  }
  return { imported, newUseful, hasMore, accounts: accountCount }
}
