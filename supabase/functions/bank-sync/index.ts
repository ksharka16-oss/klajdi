import { corsHeaders, currentUser, json } from '../_shared/gmail.ts'
import { syncBanksForUser } from '../_shared/bank-sync.ts'
import { enableBankingPsuHeaders } from '../_shared/enablebanking.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin'); if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const body = await req.json().catch(() => ({})), psuHeaders = body?.interactive === true ? enableBankingPsuHeaders(req.headers) : undefined
    return json(await syncBanksForUser(user.id, { psuHeaders }), 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
