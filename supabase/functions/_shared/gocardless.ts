const baseUrl = 'https://bankaccountdata.gocardless.com/api/v2'
let accessToken = '', accessExpiresAt = 0

async function token() {
  if (accessToken && Date.now() < accessExpiresAt - 60000) return accessToken
  const secretId = (Deno.env.get('GOCARDLESS_SECRET_ID') ?? '').trim(), secretKey = (Deno.env.get('GOCARDLESS_SECRET_KEY') ?? '').trim()
  if (!secretId || !secretKey) throw new Error('GoCardless non è ancora configurato.')
  const response = await fetch(`${baseUrl}/token/new/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access) throw new Error(data.detail ?? 'Credenziali GoCardless non valide.')
  accessToken = data.access; accessExpiresAt = Date.now() + Number(data.access_expires ?? 86400) * 1000
  return accessToken
}

export async function gc(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail ?? data.summary ?? `Errore Open Banking (${response.status}).`)
  return data
}

export function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)), binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function accountBalance(data: any) {
  const balances = Array.isArray(data?.balances) ? data.balances : [], preferred = balances.find((item: any) => item.balanceType === 'interimAvailable') ?? balances.find((item: any) => item.balanceType === 'closingBooked') ?? balances[0]
  return { amount: preferred?.balanceAmount?.amount == null ? null : Number(preferred.balanceAmount.amount), currency: preferred?.balanceAmount?.currency ?? 'EUR' }
}

export function bankDescription(row: any) {
  const remittance = Array.isArray(row.remittanceInformationUnstructuredArray) ? row.remittanceInformationUnstructuredArray.join(' ') : row.remittanceInformationUnstructured
  return String(remittance || row.additionalInformation || row.creditorName || row.debtorName || row.transactionId || 'Movimento bancario').trim().slice(0, 300)
}
