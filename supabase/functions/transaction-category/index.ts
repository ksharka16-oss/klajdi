import { corsHeaders, currentUser, json, adminClient } from '../_shared/gmail.ts'
import { merchantRuleKey } from '../_shared/bank.js'

Deno.serve(async req => {
  const origin = req.headers.get('Origin'); if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  const body = await req.json().catch(() => ({})), transactionId = String(body.transaction_id ?? ''), categoryId = body.category_id ? String(body.category_id) : null
  if (!transactionId) return json({ error: 'Movimento non valido.' }, 400, origin)
  const admin = adminClient(), { data: transaction } = await admin.from('transactions').select('id,kind,source,description,is_transfer').eq('id', transactionId).eq('user_id', user.id).maybeSingle()
  if (!transaction) return json({ error: 'Movimento non trovato.' }, 404, origin)
  if (transaction.is_transfer) return json({ error: 'Un trasferimento tra conti non usa categorie di spesa.' }, 409, origin)
  if (categoryId) { const { data: category } = await admin.from('categories').select('id,kind').eq('id', categoryId).eq('user_id', user.id).maybeSingle(); if (!category || ![transaction.kind,'both'].includes(category.kind)) return json({ error: 'Categoria non compatibile.' }, 400, origin) }
  const updated = await admin.from('transactions').update({ category_id: categoryId, updated_at: new Date().toISOString() }).eq('id', transaction.id).eq('user_id', user.id)
  if (updated.error) return json({ error: 'Impossibile aggiornare la categoria.' }, 500, origin)
  const key = transaction.source === 'bank' && categoryId ? merchantRuleKey(transaction.description) : null
  if (key) { const { data: existing } = await admin.from('learning_rules').select('id,confirmations').eq('user_id', user.id).eq('rule_type', 'merchant_category').contains('pattern', { key }).maybeSingle(), rule = { user_id: user.id, rule_type: 'merchant_category', pattern: { key }, outcome: { category_id: categoryId }, confidence: 1, confirmations: Number(existing?.confirmations ?? 0) + 1, updated_at: new Date().toISOString() }; if (existing) await admin.from('learning_rules').update(rule).eq('id', existing.id).eq('user_id', user.id); else await admin.from('learning_rules').insert(rule) }
  return json({ updated: true, learned: Boolean(key) }, 200, origin)
})
