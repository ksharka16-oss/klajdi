import { adminClient, clientId, clientSecret, decryptToken, encryptToken } from './gmail.ts'
import { autoInvoiceCandidate, classifyEmail, extractFinancialFields, financialStatus, gmailRollingRange, paidExpenseCandidate, paymentInvoiceMatch, supportedFinancialAttachment } from './classification.js'
import { isDateInWindow, transactionWindow } from './enablebanking.ts'

function header(message: any, name: string) { return message.payload?.headers?.find((item: any) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? '' }
function attachmentNames(part: any): string[] { return (part?.filename ? [part.filename] : []).concat((part?.parts ?? []).flatMap(attachmentNames)) }
function attachmentParts(part: any): any[] { return (part?.filename && (part?.body?.attachmentId || part?.body?.data) ? [{ filename: part.filename, mimeType: part.mimeType ?? 'application/octet-stream', size: Number(part.body?.size ?? 0), attachmentId: part.body?.attachmentId ?? null, data: part.body?.data ?? null }] : []).concat((part?.parts ?? []).flatMap(attachmentParts)) }
function safeFileName(value: string) { return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'documento' }
function decodeBase64Url(value: string) { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'), binary = atob(normalized); return Uint8Array.from(binary, character => character.charCodeAt(0)) }
function messageBodyText(part: any): string {
  const own = part?.body?.data && /^text\/(plain|html)$/i.test(part?.mimeType ?? '') ? new TextDecoder().decode(decodeBase64Url(part.body.data)) : ''
  const nested = (part?.parts ?? []).map(messageBodyText).join(' ')
  return `${own} ${nested}`.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}
async function sha256(value: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte => byte.toString(16).padStart(2, '0')).join('') }
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

async function saveAttachments(admin: any, message: any, accessToken: string, userId: string, accountId: string, emailId: string) {
  const parts = attachmentParts(message.payload).filter(supportedFinancialAttachment).slice(0, 3)
  for (const part of parts) {
    let encoded = part.data
    if (!encoded && part.attachmentId) {
      const response = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.attachmentId)}`, accessToken)
      const body = await response.json()
      if (!response.ok || !body.data) continue
      encoded = body.data
    }
    if (!encoded) continue
    const bytes = decodeBase64Url(encoded)
    if (!bytes.byteLength || bytes.byteLength > 10485760) continue
    const fileHash = await sha256(bytes)
    const { data: existing } = await admin.from('attachments').select('id').eq('user_id', userId).eq('file_hash', fileHash).maybeSingle()
    if (existing) continue
    const path = `${userId}/email/${accountId}/${message.id}/${safeFileName(part.filename)}`
    const upload = await admin.storage.from('invoice-documents').upload(path, bytes, { contentType: part.mimeType, upsert: false })
    if (upload.error && upload.error.statusCode !== '409') throw upload.error
    const inserted = await admin.from('attachments').insert({ user_id: userId, email_id: emailId, file_name: part.filename, mime_type: part.mimeType, byte_size: bytes.byteLength, file_hash: fileHash, storage_path: path })
    if (inserted.error && inserted.error.code !== '23505') { await admin.storage.from('invoice-documents').remove([path]); throw inserted.error }
  }
}

async function reconcilePaymentConfirmation(admin: any, userId: string, emailId: string, extracted: any) {
  const { data: invoices, error } = await admin.from('invoices').select('id,amount,iuv,invoice_number,status').eq('user_id', userId).neq('status', 'paid').limit(500)
  if (error) throw error
  const candidates = (invoices ?? []).map(invoice => ({ invoice, match: paymentInvoiceMatch(extracted, invoice) })).filter(item => item.match.matched).sort((a, b) => b.match.confidence - a.match.confidence)
  if (candidates.length !== 1 || candidates[0].match.confidence < .97) return null
  const winner = candidates[0]
  const updated = await admin.from('invoices').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', winner.invoice.id).eq('user_id', userId).neq('status', 'paid').select('id').maybeSingle()
  if (updated.error) throw updated.error
  if (!updated.data) return null
  await admin.from('audit_log').insert({ user_id: userId, action: 'invoice_marked_paid_from_email', entity_type: 'invoice', entity_id: winner.invoice.id, metadata: { email_id: emailId, confidence: winner.match.confidence, reason: winner.match.reason } })
  return { invoice_id: winner.invoice.id, confidence: winner.match.confidence, reason: winner.match.reason }
}

async function createInvoiceFromEmail(admin: any, userId: string, emailId: string, classification: string, status: string, extracted: any, files: string[]) {
  if (!autoInvoiceCandidate(classification, status, extracted, files)) return null
  const { data: existing } = await admin.from('invoices').select('id').eq('user_id', userId).eq('source_email_id', emailId).maybeSingle()
  if (existing) return existing.id
  const { data: attachment } = await admin.from('attachments').select('*').eq('user_id', userId).eq('email_id', emailId).order('created_at').limit(1).maybeSingle()
  const invoiceId = crypto.randomUUID()
  const inserted = await admin.from('invoices').insert({ id: invoiceId, user_id: userId, source_email_id: emailId, supplier: extracted.supplier, amount: Number(extracted.amount), invoice_number: extracted.invoice_number ?? null, iuv: extracted.iuv ?? null, due_on: extracted.due_on ?? null, status: 'to_pay', confidence: .95, extracted_data: extracted, ocr_status: 'not_requested', storage_path: attachment?.storage_path ?? null, document_name: attachment?.file_name ?? null, document_mime: attachment?.mime_type ?? null, document_size: attachment?.byte_size ?? null, file_hash: attachment?.file_hash ?? null }).select('id').single()
  if (inserted.error) { if (inserted.error.code === '23505') return null; throw inserted.error }
  if (attachment) await admin.from('attachments').update({ invoice_id: invoiceId }).eq('id', attachment.id).eq('user_id', userId)
  await admin.from('audit_log').insert({ user_id: userId, action: 'invoice_created_from_email', entity_type: 'invoice', entity_id: invoiceId, metadata: { email_id: emailId, classification } })
  return invoiceId
}

async function createExpenseFromPaidEmail(admin: any, userId: string, emailId: string, classification: string, status: string, extracted: any, receivedAt: string | null) {
  if (!paidExpenseCandidate(classification, status, extracted)) return null
  const fingerprint = `email:${emailId}`
  const { data: existing, error: lookupError } = await admin.from('transactions').select('id').eq('user_id', userId).eq('fingerprint', fingerprint).maybeSingle()
  if (lookupError) throw lookupError
  if (existing) return existing.id
  const transactionId = crypto.randomUUID()
  const occurredOn = receivedAt ? new Date(receivedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  const profile = (await admin.from('profiles').select('transactions_start_on,timezone').eq('id', userId).maybeSingle()).data
  const allowed = transactionWindow(profile?.transactions_start_on, profile?.timezone || 'Europe/Rome')
  if (!isDateInWindow(occurredOn, allowed.dateFrom, allowed.dateTo)) return null
  const inserted = await admin.from('transactions').insert({ id: transactionId, user_id: userId, kind: 'expense', amount: Number(extracted.amount), currency: 'EUR', description: `Pagamento ${extracted.supplier}`, occurred_on: occurredOn, source: 'email', external_id: emailId, fingerprint, reconciled: false }).select('id').single()
  if (inserted.error) {
    if (inserted.error.code === '23505') return null
    throw inserted.error
  }
  await admin.from('audit_log').insert({ user_id: userId, action: 'expense_created_from_paid_email', entity_type: 'transaction', entity_id: transactionId, metadata: { email_id: emailId, classification, amount: Number(extracted.amount) } })
  return transactionId
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
  listUrl.searchParams.set('maxResults', '100'); listUrl.searchParams.set('q', rollingRange.query)
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
      const subject = header(message, 'Subject'), sender = header(message, 'From'), snippet = message.snippet ?? '', bodyText = messageBodyText(message.payload), content = `${snippet} ${bodyText}`.slice(0, 100000), files = attachmentNames(message.payload)
      const messageClassification = classifyEmail(subject, sender, content, files)
      const status = financialStatus(messageClassification, subject, sender, content, files)
      if (!status) {
        if (existing?.id) {
          const { error } = await admin.from('emails').update({ classification: messageClassification, financial_status: null, processing_state: 'complete', last_error: null }).eq('id', existing.id).eq('user_id', userId)
          if (error) throw error
        }
        return { imported: 1, newUseful: 0 }
      }
      const extracted = extractFinancialFields(subject, sender, content, files)
      const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null
      const { data: savedEmail, error } = await admin.from('emails').upsert({ user_id: userId, email_account_id: account.id, provider_message_id: message.id, thread_id: message.threadId ?? null, sender: sender || null, subject: subject || '(senza oggetto)', received_at: receivedAt, classification: messageClassification, financial_status: status, extracted_data: extracted.data, confidence: extracted.confidence, processing_state: 'complete', last_error: null }, { onConflict: 'email_account_id,provider_message_id' }).select('id').single()
      if (error) throw error
      await saveAttachments(admin, message, accessToken, userId, account.id, savedEmail.id)
      if (status === 'to_pay') await createInvoiceFromEmail(admin, userId, savedEmail.id, messageClassification, status, extracted.data, files)
      if (status === 'paid') await createExpenseFromPaidEmail(admin, userId, savedEmail.id, messageClassification, status, extracted.data, receivedAt)
      if (messageClassification === 'payment_confirmation') {
        const reconciliation = await reconcilePaymentConfirmation(admin, userId, savedEmail.id, extracted.data)
        if (reconciliation) await admin.from('emails').update({ extracted_data: { ...extracted.data, matched_invoice_id: reconciliation.invoice_id, payment_match: reconciliation } }).eq('id', savedEmail.id).eq('user_id', userId)
      }
      return { imported: 1, newUseful: !existing ? 1 : 0 }
    } catch (error) {
      const existing = await admin.from('emails').select('retry_count').eq('email_account_id', account.id).eq('provider_message_id', messageId).maybeSingle()
      await admin.from('emails').upsert({ user_id: userId, email_account_id: account.id, provider_message_id: messageId, classification: 'normal', financial_status: null, processing_state: 'retry', retry_count: Number(existing.data?.retry_count ?? 0) + 1, last_error: error instanceof Error ? error.message : 'Errore sconosciuto' }, { onConflict: 'email_account_id,provider_message_id' })
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
  const failedAccountIds = new Set<string>()
  while (hasMore && page < (options.maxPages ?? 1)) {
    const { data: accounts, error } = await admin.from('email_accounts').select('id,sync_cursor').eq('user_id', userId).eq('provider', 'gmail')
    if (error) throw error
    accountCount = accounts?.length ?? 0
    if (!accountCount) return { imported, newUseful, hasMore: false, accounts: 0 }
    const activeAccounts = accounts!.filter(account => !failedAccountIds.has(account.id))
    if (!activeAccounts.length) break
    const settled = await Promise.allSettled(activeAccounts.map(account => syncAccountPage(account, userId, Boolean(options.restart && page === 0))))
    const results = settled.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value]
      failedAccountIds.add(activeAccounts[index].id)
      return []
    })
    imported += results.reduce((n, value) => n + value.imported, 0); newUseful += results.reduce((n, value) => n + value.newUseful, 0); hasMore = results.some(value => value.hasMore); page += 1
  }
  return { imported, newUseful, hasMore, accounts: accountCount, failedAccounts: failedAccountIds.size }
}
