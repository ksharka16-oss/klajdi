import { adminClient, appOrigin, clientId, clientSecret, corsHeaders, currentUser, json, redirectUri, sha256 } from '../_shared/gmail.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405, origin)
  if (!clientId || !clientSecret) return json({ error: 'Credenziali Google non configurate.' }, 503, origin)

  const user = await currentUser(req)
  if (!user) return json({ error: 'Sessione non valida.' }, 401, origin)

  const body = await req.json().catch(() => ({}))
  const { data: requestedAccount } = body?.email_account_id ? await adminClient().from('email_accounts').select('email_address').eq('id', body.email_account_id).eq('user_id', user.id).eq('provider', 'gmail').maybeSingle() : { data: null }

  const state = crypto.randomUUID() + crypto.randomUUID()
  const { error } = await adminClient().from('gmail_oauth_states').insert({
    user_id: user.id,
    state_hash: await sha256(state),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) return json({ error: 'Impossibile avviare il collegamento Gmail.' }, 500, origin)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  if (requestedAccount?.email_address) params.set('login_hint', requestedAccount.email_address)
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, 200, origin)
})
