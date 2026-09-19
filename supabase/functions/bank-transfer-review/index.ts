import { corsHeaders, currentUser, json, adminClient } from '../_shared/gmail.ts'
import { ownTransferKey } from '../_shared/bank.js'

Deno.serve(async req => {
  const origin = req.headers.get('Origin'); if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  const body = await req.json().catch(() => ({})), transactionId = String(body.transaction_id ?? ''), decision = body.decision === 'confirm' ? 'confirm' : body.decision === 'reject' ? 'reject' : ''
  if (!transactionId || !decision) return json({ error: 'Decisione non valida.' }, 400, origin)
  const admin = adminClient(), { data: transaction } = await admin.from('transactions').select('id,description,transfer_status').eq('id', transactionId).eq('user_id', user.id).eq('source', 'bank').maybeSingle()
  if (!transaction) return json({ error: 'Movimento non trovato.' }, 404, origin)
  const confirmed = decision === 'confirm', changes: any = { is_transfer: confirmed, transfer_status: confirmed ? 'confirmed' : 'rejected', transfer_group_id: confirmed ? crypto.randomUUID() : null, updated_at: new Date().toISOString() }; if (confirmed) changes.category_id = null
  const updated = await admin.from('transactions').update(changes).eq('id', transaction.id).eq('user_id', user.id)
  if (updated.error) return json({ error: 'Impossibile salvare la decisione.' }, 500, origin)
  const key = ownTransferKey(transaction.description)
  if (key) { const { data: existing } = await admin.from('learning_rules').select('id').eq('user_id', user.id).eq('rule_type', 'own_transfer').contains('pattern', { key }).maybeSingle(); const rule = { user_id: user.id, rule_type: 'own_transfer', pattern: { key }, outcome: { is_transfer: confirmed }, confidence: 1, confirmations: 1, updated_at: new Date().toISOString() }; if (existing) await admin.from('learning_rules').update(rule).eq('id', existing.id).eq('user_id', user.id); else await admin.from('learning_rules').insert(rule) }
  return json({ confirmed, learned: Boolean(key) }, 200, origin)
})
