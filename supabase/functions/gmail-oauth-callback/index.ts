import { adminClient, appOrigin, clientId, clientSecret, encryptToken, redirectUri, sha256 } from '../_shared/gmail.ts'

const finish = (result: string, detail = '') => Response.redirect(`${appOrigin}/?gmail=${result}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`, 302)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (url.searchParams.get('error')) return finish('error', 'Autorizzazione Google annullata.')
  if (!code || !state || !clientId || !clientSecret) return finish('error', 'Richiesta OAuth non valida.')

  const admin = adminClient()
  const stateHash = await sha256(state)
  const { data: savedState } = await admin.from('gmail_oauth_states').select('id,user_id,expires_at,used_at').eq('state_hash', stateHash).maybeSingle()
  if (!savedState || savedState.used_at || new Date(savedState.expires_at).getTime() < Date.now()) return finish('error', 'Collegamento scaduto: riprova.')

  const { data: consumed } = await admin.from('gmail_oauth_states').update({ used_at: new Date().toISOString() }).eq('id', savedState.id).is('used_at', null).select('id').maybeSingle()
  if (!consumed) return finish('error', 'Collegamento già utilizzato.')

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  const tokens = await tokenResponse.json()
  if (!tokenResponse.ok || !tokens.access_token) return finish('error', 'Google non ha restituito i permessi richiesti.')

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  const profile = await profileResponse.json()
  if (!profileResponse.ok || !profile.id || !profile.email) return finish('error', 'Impossibile leggere l’account Google.')

  const { data: account, error: accountError } = await admin.from('email_accounts').upsert({
    user_id: savedState.user_id,
    provider: 'gmail',
    email_address: profile.email,
    provider_account_id: profile.id,
  }, { onConflict: 'user_id,provider,provider_account_id' }).select('id').single()
  if (accountError || !account) return finish('error', 'Impossibile salvare l’account Gmail.')

  const { data: previous } = await admin.from('gmail_credentials').select('refresh_token_encrypted').eq('email_account_id', account.id).maybeSingle()
  const credential = {
    email_account_id: account.id,
    user_id: savedState.user_id,
    access_token_encrypted: await encryptToken(tokens.access_token),
    refresh_token_encrypted: tokens.refresh_token ? await encryptToken(tokens.refresh_token) : previous?.refresh_token_encrypted ?? null,
    token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
    scope: tokens.scope ?? null,
    updated_at: new Date().toISOString(),
  }
  const { error: credentialError } = await admin.from('gmail_credentials').upsert(credential)
  if (credentialError) return finish('error', 'Impossibile proteggere le credenziali Gmail.')
  return finish('connected')
})

