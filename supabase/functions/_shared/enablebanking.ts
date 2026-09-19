const baseUrl = 'https://api.enablebanking.com'

const encode = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function bearer() {
  const appId = (Deno.env.get('ENABLE_BANKING_APP_ID') ?? '').trim()
  const pem = (Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n').trim()
  if (!appId || !pem) throw new Error('Enable Banking non è ancora configurato.')
  const raw = pem.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g, '')
  const der = Uint8Array.from(atob(raw), character => character.charCodeAt(0))
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } catch {
    throw new Error('La chiave privata Enable Banking deve essere in formato PKCS#8.')
  }
  const now = Math.floor(Date.now() / 1000)
  const head = encode(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }))
  const body = encode(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }))
  const message = `${head}.${body}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message)))
  return `${message}.${encode(signature)}`
}

export async function eb(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${await bearer()}`, ...(init.headers ?? {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data?.detail ?? data?.message ?? data?.error?.message ?? data?.error
    throw new Error(typeof detail === 'string' ? detail : `Errore Enable Banking (${response.status}).`)
  }
  return data
}

export function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)), binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function institutionKey(item: any) {
  return `${String(item?.name ?? '').trim()}|${String(item?.country ?? 'IT').toUpperCase()}`
}

export function accountId(item: any) {
  return String(item?.uid ?? item?.id ?? item?.account_id ?? '')
}

export function accountBalance(data: any) {
  const balances = Array.isArray(data?.balances) ? data.balances : Array.isArray(data) ? data : []
  const preferred = balances.find((item: any) => /available/i.test(item?.balance_type ?? item?.name ?? '')) ?? balances.find((item: any) => /closing|booked/i.test(item?.balance_type ?? item?.name ?? '')) ?? balances[0]
  const source = preferred?.balance_amount ?? preferred?.balanceAmount ?? preferred
  const value = source?.amount ?? source?.value
  return { amount: value == null || !Number.isFinite(Number(value)) ? null : Number(value), currency: source?.currency ?? preferred?.currency ?? 'EUR' }
}

export function transactionAmount(row: any) {
  const source = row?.transaction_amount ?? row?.transactionAmount ?? row?.amount ?? {}
  const raw = typeof source === 'object' ? source.amount ?? source.value : source
  return { amount: Number(raw), currency: source?.currency ?? row?.currency ?? 'EUR' }
}

export function bankDescription(row: any) {
  const remittance = row?.remittance_information ?? row?.remittanceInformationUnstructuredArray ?? row?.remittanceInformationUnstructured
  const text = Array.isArray(remittance) ? remittance.join(' ') : remittance
  const parties = [row?.creditor?.name, row?.debtor?.name, row?.creditor_name, row?.debtor_name].filter(Boolean).join(' ')
  return String(text || row?.additional_information || row?.merchant_name || parties || row?.transaction_id || row?.entry_reference || 'Movimento bancario').trim().slice(0, 300)
}

export function transactionRows(data: any) {
  if (Array.isArray(data?.transactions)) return data.transactions
  if (Array.isArray(data?.transactions?.booked)) return data.transactions.booked
  if (Array.isArray(data?.booked)) return data.booked
  return []
}

export function transactionContinuation(data: any) {
  const value = data?.continuation_key ?? data?.continuationKey ?? data?.transactions?.continuation_key ?? data?.transactions?.continuationKey
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function isBookedTransaction(row: any) {
  const status = String(row?.status ?? row?.transaction_status ?? row?.transactionStatus ?? '').trim().toUpperCase()
  return !status || ['BOOK', 'BOOKED', 'COMPLETED', 'ACSC'].includes(status)
}

export function transactionDate(row: any) {
  return String(row?.booking_date ?? row?.bookingDate ?? row?.value_date ?? row?.valueDate ?? row?.transaction_date ?? row?.transactionDate ?? '').slice(0, 10)
}

export function isTransactionInRange(row: any, dateFrom: string, dateTo: string) {
  const value = transactionDate(row)
  return Boolean(value && value >= dateFrom && value <= dateTo)
}

export function isExpiredBankSession(error: any) {
  const message = String(error?.message ?? error ?? '')
  return /session\s+(?:is\s+)?expired|expired\s+session/i.test(message)
}
