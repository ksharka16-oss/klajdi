import { appOrigin, json, adminClient, sha256 } from '../_shared/gmail.ts'
import { accountBalance, accountId, eb } from '../_shared/enablebanking.ts'

const redirect = (ok: boolean, detail = '') => Response.redirect(`${appOrigin}/?page=Banca&bank=${ok ? 'connected' : 'error'}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`, 302)
Deno.serve(async req => {
  try {
    const params = new URL(req.url).searchParams, state = params.get('state') ?? '', code = params.get('code') ?? ''; if (!state || !code) return redirect(false, 'Collegamento bancario non valido.')
    const admin = adminClient(), stateHash = await sha256(state), connection = await admin.from('bank_connections').select('*').eq('state_hash', stateHash).eq('status', 'pending').maybeSingle()
    if (!connection.data || !connection.data.state_expires_at || Date.parse(connection.data.state_expires_at) < Date.now()) return redirect(false, 'Autorizzazione scaduta: riprova.')
    const session = await eb('/sessions', { method: 'POST', body: JSON.stringify({ code }) })
    if (!session.session_id || !Array.isArray(session.accounts) || !session.accounts.length) return redirect(false, 'La banca non ha restituito alcun conto.')
    for (const item of session.accounts) {
      const id = accountId(item); if (!id) continue
      const [details, balances] = await Promise.all([eb(`/accounts/${encodeURIComponent(id)}/details`), eb(`/accounts/${encodeURIComponent(id)}/balances`)]), account = details.account ?? details ?? item, balance = accountBalance(balances), iban = String(account.iban ?? account.account_id?.iban ?? '')
      const saved = await admin.from('accounts').upsert({ user_id: connection.data.user_id, name: account.name || account.product || account.display_name || connection.data.institution_name, institution: connection.data.institution_name, iban_last4: iban ? iban.slice(-4) : null, currency: balance.currency, current_balance: balance.amount ?? 0, external_provider: 'enablebanking', external_account_id: id, updated_at: new Date().toISOString() }, { onConflict: 'user_id,external_provider,external_account_id' })
      if (saved.error) throw saved.error
    }
    const validUntil = String(session.access?.valid_until ?? connection.data.valid_until ?? '').slice(0, 10) || null
    await admin.from('bank_connections').update({ requisition_id: session.session_id, status: 'linked', state_hash: null, state_expires_at: null, valid_until: validUntil, updated_at: new Date().toISOString() }).eq('id', connection.data.id)
    return redirect(true)
  } catch (error) { return redirect(false, error.message) }
})
