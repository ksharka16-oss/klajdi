import { corsHeaders, currentUser, json, adminClient, sha256 } from '../_shared/gmail.ts'
import { gc, randomState } from '../_shared/gocardless.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const body = await req.json().catch(() => ({})), institutionId = String(body.institution_id ?? '')
    const institutions = await gc('/institutions/?country=it&private_accounts_supported=true'), institution = institutions.find((item: any) => item.id === institutionId && /unicredit|ing/i.test(item.name))
    if (!institution) return json({ error: 'Banca non disponibile.' }, 400, origin)
    const admin = adminClient(), existing = await admin.from('bank_connections').select('id,status').eq('user_id', user.id).eq('institution_id', institution.id).in('status', ['pending', 'linked']).maybeSingle()
    if (existing.data?.status === 'linked') return json({ error: 'Questa banca è già collegata.' }, 409, origin)
    const connectionId = existing.data?.id ?? crypto.randomUUID(), state = randomState(), stateHash = await sha256(state), expires = new Date(Date.now() + 15 * 60000).toISOString()
    const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bank-oauth-callback?state=${encodeURIComponent(state)}`
    const requisition = await gc('/requisitions/', { method: 'POST', body: JSON.stringify({ redirect: callback, institution_id: institution.id, reference: connectionId, user_language: 'IT' }) })
    const saved = await admin.from('bank_connections').upsert({ id: connectionId, user_id: user.id, provider: 'gocardless', institution_id: institution.id, institution_name: institution.name, requisition_id: requisition.id, status: 'pending', state_hash: stateHash, state_expires_at: expires, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (saved.error) throw saved.error
    return json({ url: requisition.link }, 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
