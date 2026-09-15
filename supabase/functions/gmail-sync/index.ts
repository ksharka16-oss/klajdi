import { corsHeaders, currentUser, json } from '../_shared/gmail.ts'
import { syncRecentForUser } from '../_shared/gmail-sync.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)

  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)

  const body = await req.json().catch(() => ({}))
  try {
    const result = await syncRecentForUser(user.id, {
      restart: body.restart === true,
      maxPages: 1,
    })
    if (!result.accounts) return json({ error: 'Collega prima un account Gmail.' }, 400, origin)
    return json({ ...result, window: 'last-30-days' }, 200, origin)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Sincronizzazione Gmail non riuscita.' }, 502, origin)
  }
})
