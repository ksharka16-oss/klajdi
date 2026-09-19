import { corsHeaders, currentUser, json, adminClient, sha256 } from '../_shared/gmail.ts'
import { eb, institutionKey, randomState } from '../_shared/enablebanking.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const body = await req.json().catch(() => ({})), institutionId = String(body.institution_id ?? ''), reconnect = body.reconnect === true
    const result = await eb('/aspsps?country=IT&psu_type=personal&service=AIS'), institutions = Array.isArray(result?.aspsps) ? result.aspsps : Array.isArray(result) ? result : [], institution = institutions.find((item: any) => institutionKey(item) === institutionId && /unicredit|ing/i.test(item.name))
    if (!institution) return json({ error: 'Banca non disponibile.' }, 400, origin)
    const bankKey = institutionKey(institution)
    const admin = adminClient(), existing = await admin.from('bank_connections').select('id,status,valid_until').eq('user_id', user.id).eq('institution_id', bankKey).in('status', ['pending', 'linked']).maybeSingle()
    if (existing.data?.status === 'linked' && !reconnect) return json({ error: 'Questa banca è già collegata.' }, 409, origin)
    const connectionId = existing.data?.id ?? crypto.randomUUID(), state = randomState(), stateHash = await sha256(state), expires = new Date(Date.now() + 15 * 60000).toISOString()
    const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bank-oauth-callback`
    const validUntil = new Date(Date.now() + 180 * 86400000).toISOString()
    const authorization = await eb('/auth', { method: 'POST', body: JSON.stringify({ access: { valid_until: validUntil }, aspsp: { name: institution.name, country: String(institution.country ?? 'IT').toUpperCase() }, state, redirect_url: callback, psu_type: 'personal', language: 'it', psu_id: user.id }) })
    const saved = await admin.from('bank_connections').upsert({ id: connectionId, user_id: user.id, provider: 'enablebanking', institution_id: bankKey, institution_name: institution.name, requisition_id: authorization.authorization_id ?? null, status: 'pending', state_hash: stateHash, state_expires_at: expires, valid_until: validUntil.slice(0, 10), updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (saved.error) throw saved.error
    if (!authorization.url) throw new Error('Enable Banking non ha restituito la pagina di autorizzazione.')
    return json({ url: authorization.url }, 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
