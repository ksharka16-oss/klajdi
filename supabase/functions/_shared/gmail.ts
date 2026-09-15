import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

export const appOrigin = 'https://klajdi.vercel.app'
export const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth-callback`
export const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
export const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

export const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin === appOrigin || origin?.startsWith('http://localhost:') ? origin : appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
})

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function currentUser(req: Request) {
  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return null
  const { data, error } = await adminClient().auth.getUser(token)
  return error ? null : data.user
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function unbase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function encryptionKey() {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${clientSecret}::soldi-gmail-tokens`))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value))
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`
}

export async function decryptToken(value: string) {
  const [iv, payload] = value.split('.')
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv) }, await encryptionKey(), unbase64(payload))
  return new TextDecoder().decode(decrypted)
}

export function json(body: unknown, status = 200, origin: string | null = appOrigin) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
}

