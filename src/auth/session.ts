export type Role = 'superuser' | 'member'

export interface SessionUser {
  sub: string
  email: string
  name: string
  role: Role
}

export interface SessionInfo {
  user: SessionUser | null
  allowedDomain: string
}

export class SessionUnavailableError extends Error {}

/**
 * Asks the sync backend who we are. The session lives in an httpOnly cookie,
 * so the answer can only come from the server — page JavaScript deliberately
 * cannot read it.
 */
export async function fetchSession(fetchFn: typeof fetch = fetch): Promise<SessionInfo> {
  let response: Response
  try {
    response = await fetchFn('/api/auth/me', { credentials: 'same-origin' })
  } catch (error) {
    throw new SessionUnavailableError('Could not reach the sign-in service.', { cause: error })
  }
  if (!response.ok) throw new SessionUnavailableError(`Sign-in service returned status ${response.status}.`)
  return (await response.json()) as SessionInfo
}

export async function signOut(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
}

/** Full page navigation: the OAuth round-trip has to leave the SPA. */
export function startSignIn(returnTo: string = window.location.pathname): void {
  window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
}

/**
 * The callback bounces failures back as ?authError=…; read it once and strip
 * it so a refresh does not resurrect a stale message.
 */
export function takeAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('authError')
  if (!error) return null
  params.delete('authError')
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  return error
}
