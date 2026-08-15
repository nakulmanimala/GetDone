import { expireCookie, parseCookies, serializeCookie } from './cookies.js'
import { signHs256, verifyHs256 } from './jwt.js'
import type { Role, User } from './userStore.js'

export const SESSION_COOKIE = 'getdone_session'
export const OAUTH_STATE_COOKIE = 'getdone_oauth'
/** The consent round-trip is quick; a short life limits replay of a stolen state. */
const OAUTH_STATE_TTL_SECONDS = 10 * 60

export interface Session {
  sub: string
  email: string
  name: string
  role: Role
}

export interface PendingOAuth {
  state: string
  codeVerifier: string
  /** Where to send the browser once sign-in completes. */
  returnTo: string
}

export function createSessionCookie(user: User, secret: string, ttlSeconds: number, secure: boolean, now: () => number = Date.now): string {
  const token = signHs256(
    {
      sub: user.sub,
      email: user.email,
      name: user.name,
      role: user.role,
      exp: Math.floor(now() / 1000) + ttlSeconds,
    },
    secret,
  )
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: ttlSeconds, secure })
}

export function readSession(cookieHeader: string | undefined, secret: string, now: () => number = Date.now): Session | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE]
  if (!token) return null

  const payload = verifyHs256(token, secret, now)
  if (!payload) return null

  const { sub, email, name, role } = payload
  if (typeof sub !== 'string' || typeof email !== 'string') return null
  if (role !== 'superuser' && role !== 'member') return null

  return { sub, email, name: typeof name === 'string' ? name : email, role }
}

export function clearSessionCookie(secure: boolean): string {
  return expireCookie(SESSION_COOKIE, secure)
}

export function createPendingOAuthCookie(pending: PendingOAuth, secret: string, secure: boolean, now: () => number = Date.now): string {
  const token = signHs256({ ...pending, exp: Math.floor(now() / 1000) + OAUTH_STATE_TTL_SECONDS }, secret)
  return serializeCookie(OAUTH_STATE_COOKIE, token, { maxAgeSeconds: OAUTH_STATE_TTL_SECONDS, secure })
}

export function readPendingOAuth(cookieHeader: string | undefined, secret: string, now: () => number = Date.now): PendingOAuth | null {
  const token = parseCookies(cookieHeader)[OAUTH_STATE_COOKIE]
  if (!token) return null

  const payload = verifyHs256(token, secret, now)
  if (!payload) return null

  const { state, codeVerifier, returnTo } = payload
  if (typeof state !== 'string' || typeof codeVerifier !== 'string') return null

  return { state, codeVerifier, returnTo: typeof returnTo === 'string' ? returnTo : '/' }
}

export function clearPendingOAuthCookie(secure: boolean): string {
  return expireCookie(OAUTH_STATE_COOKIE, secure)
}

/**
 * Only same-site paths are accepted as a post-login destination, so a crafted
 * `?returnTo=https://evil.example` cannot turn sign-in into an open redirect.
 */
export function safeReturnPath(candidate: string | null): string {
  if (!candidate) return '/'
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/'
  return candidate
}
