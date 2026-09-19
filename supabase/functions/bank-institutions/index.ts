import { corsHeaders, currentUser, json } from '../_shared/gmail.ts'
import { eb, institutionKey } from '../_shared/enablebanking.ts'

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (!await currentUser(req)) return json({ error: 'Sessione non valida.' }, 401, origin)
  try {
    const result = await eb('/aspsps?country=IT&psu_type=personal&service=AIS')
    const institutions = Array.isArray(result?.aspsps) ? result.aspsps : Array.isArray(result) ? result : []
    const wanted = institutions.filter((item: any) => /unicredit|buddy bank|^ing(?:\s|$|\()/i.test(item.name)).map((item: any) => ({ id: institutionKey(item), name: item.name, logo: item.logo ?? null }))
    return json({ institutions: wanted }, 200, origin)
  } catch (error) { return json({ error: error.message }, 503, origin) }
})
