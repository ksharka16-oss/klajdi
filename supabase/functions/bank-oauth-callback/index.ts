import { appOrigin, json, adminClient, sha256 } from '../_shared/gmail.ts'
import { accountBalance, gc } from '../_shared/gocardless.ts'

const redirect = (ok: boolean, detail = '') => Response.redirect(`${appOrigin}/?page=Banca&bank=${ok ? 'connected' : 'error'}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`, 302)
Deno.serve(async req => {
  try {
    const state = new URL(req.url).searchParams.get('state') ?? ''; if (!state) return redirect(false, 'Collegamento bancario non valido.')
    const admin = adminClient(), stateHash = await sha256(state), connection = await admin.from('bank_connections').select('*').eq('state_hash', stateHash).eq('status', 'pending').maybeSingle()
    if (!connection.data || !connection.data.state_expires_at || Date.parse(connection.data.state_expires_at) < Date.now()) return redirect(false, 'Autorizzazione scaduta: riprova.')
    const requisition = await gc(`/requisitions/${connection.data.requisition_id}/`)
    if (!Array.isArray(requisition.accounts) || !requisition.accounts.length) return redirect(false, 'La banca non ha restituito alcun conto.')
    for (const accountId of requisition.accounts) {
      const [details, balances] = await Promise.all([gc(`/accounts/${accountId}/details/`), gc(`/accounts/${accountId}/balances/`)]), account = details.account ?? {}, balance = accountBalance(balances), iban = String(account.iban ?? '')
      const saved = await admin.from('accounts').upsert({ user_id: connection.data.user_id, name: account.name || account.product || connection.data.institution_name, institution: connection.data.institution_name, iban_last4: iban ? iban.slice(-4) : null, currency: balance.currency, current_balance: balance.amount, external_provider: 'gocardless', external_account_id: accountId, updated_at: new Date().toISOString() }, { onConflict: 'user_id,external_provider,external_account_id' })
      if (saved.error) throw saved.error
    }
    const validUntil = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    await admin.from('bank_connections').update({ status: 'linked', state_hash: null, state_expires_at: null, valid_until: validUntil, updated_at: new Date().toISOString() }).eq('id', connection.data.id)
    return redirect(true)
  } catch (error) { return redirect(false, error.message) }
})
