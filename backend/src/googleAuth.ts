import { createHash, randomBytes, timingSafeEqual, type JsonWebKey } from 'node:crypto'
import { verifyRs256 } from './jwt.js'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs'
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

// Google's ID tokens are short-lived and its keys rotate slowly; an hour of
// caching keeps the callback fast without holding a stale key set for long.
const JWKS_TTL_MS = 60 * 60 * 1000
// Absorbs modest clock skew between this container and Google.
const CLOCK_SKEW_SECONDS = 60

export class GoogleAuthError extends Error {}
export class DomainNotAllowedError extends Error {}

export interface GoogleIdentity {
  sub: string
  email: string
  name: string
  picture?: string
}

export interface OAuthStart {
  url: string
  state: string
  codeVerifier: string
}

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  allowedDomain: string
}

function base64Url(input: Buffer): string {
  return input.toString('base64url')
}

/**
 * Builds the consent URL for the authorization-code flow.
 *
 * `hd` and `login_hint` only *steer* the account chooser — a determined user
 * can strip them from the URL — so the domain is enforced again on the token
 * in verifyIdToken. This one is purely so teammates see the right picker.
 */
export function buildAuthorizationUrl(config: GoogleOAuthConfig, prompt?: string): OAuthStart {
  const state = base64Url(randomBytes(32))
  const codeVerifier = base64Url(randomBytes(32))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())

  const url = new URL(AUTH_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    hd: config.allowedDomain,
    ...(prompt ? { prompt } : {}),
  }).toString()

  return { url: url.toString(), state, codeVerifier }
}

/** Constant-time compare for the CSRF state, which is attacker-supplied. */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface Fetcher {
  (input: string, init?: RequestInit): Promise<Response>
}

export async function exchangeCodeForIdToken(
  config: GoogleOAuthConfig,
  code: string,
  codeVerifier: string,
  fetchFn: Fetcher = fetch,
): Promise<string> {
  const response = await fetchFn(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }).toString(),
  })

  if (!response.ok) {
    // The body can echo the code and client_secret back; never log or forward it.
    throw new GoogleAuthError(`Token exchange failed with status ${response.status}`)
  }

  const body = (await response.json()) as { id_token?: unknown }
  if (typeof body.id_token !== 'string') throw new GoogleAuthError('Token response contained no id_token')
  return body.id_token
}

export function createJwksCache(fetchFn: Fetcher = fetch, now: () => number = Date.now) {
  let keys: JsonWebKey[] | null = null
  let fetchedAt = 0

  return async function getKeys(forceRefresh = false): Promise<JsonWebKey[]> {
    if (!forceRefresh && keys && now() - fetchedAt < JWKS_TTL_MS) return keys

    const response = await fetchFn(JWKS_ENDPOINT)
    if (!response.ok) throw new GoogleAuthError(`Could not fetch Google signing keys (status ${response.status})`)
    const body = (await response.json()) as { keys?: JsonWebKey[] }
    if (!Array.isArray(body.keys) || body.keys.length === 0) throw new GoogleAuthError('Google signing key set was empty')

    keys = body.keys
    fetchedAt = now()
    return keys
  }
}

/**
 * Verifies a Google ID token and enforces the workspace domain.
 *
 * The domain check is the whole point of this feature, so it is deliberately
 * belt-and-braces: the token must carry `hd` for the allowed domain *and* a
 * verified email in that same domain. `hd` alone would trust a claim we do
 * not control the shape of; the email suffix alone would accept a personal
 * Gmail account that merely happens to have such an address.
 */
export function verifyIdToken(
  idToken: string,
  keys: JsonWebKey[],
  config: GoogleOAuthConfig,
  now: () => number = Date.now,
): GoogleIdentity {
  const payload = verifyRs256(idToken, keys)
  const nowSeconds = Math.floor(now() / 1000)

  if (typeof payload.iss !== 'string' || !VALID_ISSUERS.includes(payload.iss)) {
    throw new GoogleAuthError('Token issuer is not Google')
  }
  if (payload.aud !== config.clientId) {
    throw new GoogleAuthError('Token was issued for a different client')
  }
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new GoogleAuthError('Token has expired')
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new GoogleAuthError('Token was issued in the future')
  }

  const sub = payload.sub
  const email = payload.email
  if (typeof sub !== 'string' || !sub) throw new GoogleAuthError('Token has no subject')
  if (typeof email !== 'string' || !email) throw new GoogleAuthError('Token has no email')
  if (payload.email_verified !== true) throw new GoogleAuthError('Google has not verified this email address')

  const domain = config.allowedDomain.toLowerCase()
  const emailDomain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  if (payload.hd !== config.allowedDomain || emailDomain !== domain) {
    throw new DomainNotAllowedError(`Only ${config.allowedDomain} accounts can sign in`)
  }

  return {
    sub,
    email,
    name: typeof payload.name === 'string' && payload.name ? payload.name : email,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  }
}
