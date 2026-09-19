import { corsHeaders, currentUser, json } from '../_shared/gmail.ts'
import { syncBanksForUser } from '../_shared/bank-sync.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin'); if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  const user = await currentUser(req); if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    return json(await syncBanksForUser(user.id), 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
