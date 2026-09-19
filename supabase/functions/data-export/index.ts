import { corsHeaders, currentUser, json, adminClient } from '../_shared/gmail.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const admin = adminClient(), own = (table: string, columns = '*') => admin.from(table).select(columns).eq('user_id', user.id)
    const [profile,categories,accounts,transactions,invoices,deadlines,reconciliations,budgets,rules,emailAccounts,emails,attachments] = await Promise.all([
      admin.from('profiles').select('display_name,currency,timezone,created_at,updated_at').eq('id', user.id).maybeSingle(),
      own('categories'), own('accounts','id,name,institution,iban_last4,currency,current_balance,created_at,updated_at'), own('transactions'), own('invoices'), own('deadlines'), own('reconciliations'), own('budgets'), own('learning_rules'), own('email_accounts','id,provider,email_address,provider_account_id,last_synced_at,created_at'), own('emails','id,email_account_id,provider_message_id,thread_id,sender,subject,received_at,classification,financial_status,processing_state,extracted_data,confidence,created_at'), own('attachments','id,email_id,invoice_id,file_name,mime_type,byte_size,file_hash,created_at')
    ])
    const results = [profile,categories,accounts,transactions,invoices,deadlines,reconciliations,budgets,rules,emailAccounts,emails,attachments], failed = results.find(result => result.error)?.error
    if (failed) throw failed
    return json({ format: 'soldi-backup', version: 1, exported_at: new Date().toISOString(), user: { id: user.id, email: user.email }, exclusions: ['password','oauth_tokens','bank_credentials','push_subscriptions','document_binaries'], data: { profile: profile.data, categories: categories.data, accounts: accounts.data, transactions: transactions.data, invoices: invoices.data, deadlines: deadlines.data, reconciliations: reconciliations.data, budgets: budgets.data, learning_rules: rules.data, email_accounts: emailAccounts.data, financial_emails: emails.data, attachments: attachments.data } }, 200, origin)
  } catch (error) { return json({ error: error.message || 'Backup non disponibile.' }, 500, origin) }
})
