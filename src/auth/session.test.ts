import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSession, SessionUnavailableError, signOut, takeAuthError } from './session'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const signedIn = {
  user: { sub: '1001', email: 'nakul@entri.me', name: 'Nakul', role: 'superuser' },
  allowedDomain: 'entri.me',
}

describe('fetchSession', () => {
  it('sends credentials so the httpOnly cookie is attached', async () => {
    let captured: RequestInit | undefined
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = init
      return jsonResponse(200, signedIn)
    })

    expect(await fetchSession(fetchFn as unknown as typeof fetch)).toEqual(signedIn)
    expect(captured?.credentials).toBe('same-origin')
  })

  it('reports a signed-out session without treating it as an error', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { user: null, allowedDomain: 'entri.me' }))
    expect((await fetchSession(fetchFn as unknown as typeof fetch)).user).toBeNull()
  })

  it('raises when the backend is unreachable', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('network down') })
    await expect(fetchSession(fetchFn as unknown as typeof fetch)).rejects.toThrow(SessionUnavailableError)
  })

  it('raises on a non-OK response rather than guessing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(502, { error: 'bad gateway' }))
    await expect(fetchSession(fetchFn as unknown as typeof fetch)).rejects.toThrow(SessionUnavailableError)
  })
})

describe('signOut', () => {
  it('posts to the logout endpoint with credentials', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }))

    await signOut(fetchFn as unknown as typeof fetch)

    expect(fetchFn).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  })
})

describe('takeAuthError', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'))

  it('returns null when there is no error in the URL', () => {
    expect(takeAuthError()).toBeNull()
  })

  it('reads the message and strips it from the URL so a refresh is clean', () => {
    window.history.replaceState({}, '', '/?authError=Only%20entri.me%20accounts%20can%20use%20GetDone.')

    expect(takeAuthError()).toBe('Only entri.me accounts can use GetDone.')
    expect(window.location.search).toBe('')
    expect(takeAuthError()).toBeNull()
  })

  it('leaves other query parameters intact', () => {
    window.history.replaceState({}, '', '/?keep=1&authError=Nope')

    expect(takeAuthError()).toBe('Nope')
    expect(window.location.search).toBe('?keep=1')
  })
})
