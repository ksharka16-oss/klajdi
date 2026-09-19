import { corsHeaders, currentUser, json } from '../_shared/gmail.ts'
import { gc } from '../_shared/gocardless.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (!await currentUser(req)) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const institutions = await gc('/institutions/?country=it&private_accounts_supported=true')
    const wanted = institutions.filter((item: any) => /unicredit|ing/i.test(item.name)).map((item: any) => ({ id: item.id, name: item.name, logo: item.logo, max_access_valid_for_days: item.max_access_valid_for_days }))
    return json({ institutions: wanted }, 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
