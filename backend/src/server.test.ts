import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './server.js'
import type { Config } from './config.js'
import type { Snapshot, SnapshotMeta, SnapshotStore } from './snapshotStore.js'
import type { User, UserStore } from './userStore.js'
import { createSessionCookie, SESSION_COOKIE } from './session.js'

const SESSION_SECRET = 'a'.repeat(40)
const ENCRYPTION_KEY = randomBytes(32)

const config: Config = {
  port: 0,
  s3Bucket: 'bucket',
  s3SnapshotPrefix: 'getdone/users',
  s3UsersKey: 'getdone/users.json',
  encryptionKey: ENCRYPTION_KEY,
  sessionSecret: SESSION_SECRET,
  sessionTtlSeconds: 3600,
  appOrigin: 'http://localhost:3080',
  googleClientId: 'client-123',
  googleClientSecret: 'client-secret',
  allowedDomain: 'entri.me',
}

const alice: User = {
  sub: '1001', email: 'alice@entri.me', name: 'Alice', role: 'superuser',
  createdAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z',
}
const bob: User = {
  sub: '1002', email: 'bob@entri.me', name: 'Bob', role: 'member',
  createdAt: '2026-01-02T00:00:00Z', lastSeenAt: '2026-01-02T00:00:00Z',
}

/** One fake bucket shared by all keys, so cross-user isolation is observable. */
function createFakeBucket() {
  const objects = new Map<string, Snapshot>()
  return {
    objects,
    open(key: string): SnapshotStore {
      return {
        async head(): Promise<SnapshotMeta> {
          const stored = objects.get(key)
          return stored ? { exists: true, updatedAt: stored.updatedAt } : { exists: false, updatedAt: null }
        },
        async get() {
          return objects.get(key) ?? null
        },
        async put(body, updatedAt) {
          objects.set(key, { body, updatedAt })
        },
      }
    },
  }
}

const users: User[] = [alice, bob]
const userStore: UserStore = {
  async list() { return users },
  async get(sub) { return users.find((user) => user.sub === sub) ?? null },
  async signIn() { return alice },
}

let server: Server
let baseUrl: string
let bucket: ReturnType<typeof createFakeBucket>
let fetchFn: ReturnType<typeof vi.fn>

function cookieFor(user: User): string {
  // Take just the name=value pair; the attributes are for the browser.
  return createSessionCookie(user, SESSION_SECRET, 3600, false).split(';')[0]
}

function as(user: User, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: cookieFor(user) } }
}

beforeEach(() => {
  bucket = createFakeBucket()
  fetchFn = vi.fn()
})

beforeAll(async () => {
  bucket = createFakeBucket()
  fetchFn = vi.fn()
  server = createServer(
    createApp({
      config,
      userStore,
      openSnapshotStore: (key) => bucket.open(key),
      fetchFn: (...args) => fetchFn(...args) as Promise<Response>,
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const payload = {
  updatedAt: '2026-08-14T00:00:00.000Z',
  tasks: [{ id: '1', title: 'A secret task title' }],
}

describe('health and routing', () => {
  it('serves healthz without auth', async () => {
    const res = await fetch(`${baseUrl}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('healthy\n')
  })

  it('returns 404 for non-api paths', async () => {
    expect((await fetch(`${baseUrl}/somewhere`)).status).toBe(404)
  })

  it('returns 404 for unknown api routes when signed in', async () => {
    expect((await fetch(`${baseUrl}/api/unknown`, as(alice))).status).toBe(404)
  })
})

describe('authentication', () => {
  it('rejects snapshot requests with no session', async () => {
    expect((await fetch(`${baseUrl}/api/snapshot/meta`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/snapshot`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/snapshot`, { method: 'PUT', body: '{}' })).status).toBe(401)
  })

  it('no longer accepts a bearer token, the old shared-secret path', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot/meta`, { headers: { Authorization: 'Bearer test-token' } })
    expect(res.status).toBe(401)
  })

  it('rejects a forged session cookie', async () => {
    const forged = createSessionCookie(alice, 'wrong-secret-'.padEnd(40, 'x'), 3600, false).split(';')[0]
    const res = await fetch(`${baseUrl}/api/snapshot/meta`, { headers: { Cookie: forged } })
    expect(res.status).toBe(401)
  })

  it('rejects an expired session cookie', async () => {
    const expired = createSessionCookie(alice, SESSION_SECRET, -10, false).split(';')[0]
    const res = await fetch(`${baseUrl}/api/snapshot/meta`, { headers: { Cookie: expired } })
    expect(res.status).toBe(401)
  })

  it('reports the signed-out state on /api/auth/me instead of 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null, allowedDomain: 'entri.me' })
  })

  it('reports the signed-in user on /api/auth/me', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, as(alice))
    expect(await res.json()).toEqual({
      user: { sub: '1001', email: 'alice@entri.me', name: 'Alice', role: 'superuser' },
      allowedDomain: 'entri.me',
    })
  })

  it('clears the session cookie on logout', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', ...as(alice) })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`))
  })
})

describe('google sign-in redirects', () => {
  it('sends the browser to Google with the domain hint and a state cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, { redirect: 'manual' })

    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('hd')).toBe('entri.me')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(res.headers.get('set-cookie')).toContain('getdone_oauth=')
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
  })

  it('bounces a callback with no pending state back to the app with an error', async () => {
    const res = await fetch(`${baseUrl}/api/auth/callback?code=x&state=y`, { redirect: 'manual' })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^\/\?authError=/)
    expect(fetchFn).not.toHaveBeenCalled() // never exchanged the code
  })

  it('reports a cancelled sign-in without calling Google', async () => {
    const res = await fetch(`${baseUrl}/api/auth/callback?error=access_denied`, { redirect: 'manual' })

    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('cancelled')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('per-user snapshots', () => {
  it('reports no snapshot before any backup', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot/meta`, as(alice))
    expect(await res.json()).toEqual({ exists: false, updatedAt: null })
  })

  it('returns 404 fetching a snapshot before any backup', async () => {
    expect((await fetch(`${baseUrl}/api/snapshot`, as(alice))).status).toBe(404)
  })

  it('round-trips a snapshot through PUT and GET, encrypted at rest', async () => {
    const putRes = await fetch(`${baseUrl}/api/snapshot`, as(alice, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    expect(putRes.status).toBe(200)

    expect(bucket.objects.get('getdone/users/1001/snapshot.json.enc')?.body).not.toContain('A secret task title')

    expect(await (await fetch(`${baseUrl}/api/snapshot`, as(alice))).json()).toEqual(payload)
    expect(await (await fetch(`${baseUrl}/api/snapshot/meta`, as(alice))).json()).toEqual({
      exists: true,
      updatedAt: payload.updatedAt,
    })
  })

  it('writes each user to their own object', async () => {
    await fetch(`${baseUrl}/api/snapshot`, as(alice, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }))
    await fetch(`${baseUrl}/api/snapshot`, as(bob, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }))

    expect([...bucket.objects.keys()].sort()).toEqual([
      'getdone/users/1001/snapshot.json.enc',
      'getdone/users/1002/snapshot.json.enc',
    ])
  })

  // The core isolation requirement: one teammate's list must be invisible to another.
  it('does not leak one user\'s snapshot to another', async () => {
    await fetch(`${baseUrl}/api/snapshot`, as(alice, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))

    expect((await fetch(`${baseUrl}/api/snapshot`, as(bob))).status).toBe(404)
    expect(await (await fetch(`${baseUrl}/api/snapshot/meta`, as(bob))).json()).toEqual({
      exists: false,
      updatedAt: null,
    })
  })

  it('does not let one user overwrite another\'s snapshot', async () => {
    await fetch(`${baseUrl}/api/snapshot`, as(alice, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }))
    await fetch(`${baseUrl}/api/snapshot`, as(bob, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatedAt: '2026-08-15T00:00:00.000Z', tasks: [{ id: '9', title: 'Bob task' }] }),
    }))

    expect(await (await fetch(`${baseUrl}/api/snapshot`, as(alice))).json()).toEqual(payload)
  })

  it('rejects a malformed payload with 400', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot`, as(alice, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    }))
    expect(res.status).toBe(400)
  })

  it('returns 500, not a crash, for a snapshot that fails to decrypt (e.g. wrong key)', async () => {
    bucket.objects.set('getdone/users/1001/snapshot.json.enc', {
      body: JSON.stringify({ schemaVersion: 1, iv: 'aXY4NTY3ODkwMQ==', authTag: 'dGFnMTIzNDU2Nzg5MDEy', ciphertext: 'bm90LXJlYWwtY2lwaGVydGV4dA==' }),
      updatedAt: '2026-08-14T00:00:00.000Z',
    })
    expect((await fetch(`${baseUrl}/api/snapshot`, as(alice))).status).toBe(500)
  })
})

describe('admin routes', () => {
  it('lets the superuser list the team', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, as(alice))
    expect(res.status).toBe(200)
    expect((await res.json() as { users: User[] }).users.map((u) => u.email)).toEqual(['alice@entri.me', 'bob@entri.me'])
  })

  it('forbids a member from listing the team', async () => {
    expect((await fetch(`${baseUrl}/api/admin/users`, as(bob))).status).toBe(403)
  })

  it('rejects an anonymous caller before the role check', async () => {
    expect((await fetch(`${baseUrl}/api/admin/users`)).status).toBe(401)
  })

  // Role lives in the signed cookie, so tampering with it invalidates the signature.
  it('cannot be reached by editing the role in the cookie', async () => {
    const escalated: User = { ...bob, role: 'superuser' }
    const forged = createSessionCookie(escalated, 'not-the-secret'.padEnd(40, 'x'), 3600, false).split(';')[0]
    expect((await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: forged } })).status).toBe(401)
  })
})
