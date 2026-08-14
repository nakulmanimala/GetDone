import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './server'
import type { Snapshot, SnapshotMeta, SnapshotStore } from './snapshotStore'

function createFakeStore(): {
  store: SnapshotStore
  getRawBody: () => string | null
  setRawBody: (body: string, updatedAt: string) => void
} {
  let stored: Snapshot | null = null
  const store: SnapshotStore = {
    async head(): Promise<SnapshotMeta> {
      return stored ? { exists: true, updatedAt: stored.updatedAt } : { exists: false, updatedAt: null }
    },
    async get() {
      return stored
    },
    async put(body, updatedAt) {
      stored = { body, updatedAt }
    },
  }
  return {
    store,
    getRawBody: () => stored?.body ?? null,
    setRawBody: (body, updatedAt) => {
      stored = { body, updatedAt }
    },
  }
}

const TOKEN = 'test-token'
const ENCRYPTION_KEY = randomBytes(32)
let server: Server
let baseUrl: string
let getRawBody: () => string | null
let setRawBody: (body: string, updatedAt: string) => void

beforeAll(async () => {
  const fake = createFakeStore()
  getRawBody = fake.getRawBody
  setRawBody = fake.setRawBody
  server = createServer(createApp(fake.store, TOKEN, ENCRYPTION_KEY))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const payload = {
  updatedAt: '2026-08-14T00:00:00.000Z',
  tasks: [{ id: '1', title: 'A secret task title' }],
}

describe('sync server', () => {
  it('serves healthz without auth', async () => {
    const res = await fetch(`${baseUrl}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('healthy\n')
  })

  it('rejects unauthenticated api requests', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot/meta`)
    expect(res.status).toBe(401)
  })

  it('reports no snapshot before any backup', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot/meta`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(await res.json()).toEqual({ exists: false, updatedAt: null })
  })

  it('returns 404 fetching a snapshot before any backup', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })

  it('round-trips a snapshot through PUT and GET, encrypted at rest', async () => {
    const putRes = await fetch(`${baseUrl}/api/snapshot`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(putRes.status).toBe(200)

    expect(getRawBody()).not.toContain('A secret task title')

    const getRes = await fetch(`${baseUrl}/api/snapshot`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(await getRes.json()).toEqual(payload)

    const metaRes = await fetch(`${baseUrl}/api/snapshot/meta`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(await metaRes.json()).toEqual({ exists: true, updatedAt: payload.updatedAt })
  })

  it('rejects a malformed payload with 400', async () => {
    const res = await fetch(`${baseUrl}/api/snapshot`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/api/unknown`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns 500, not a crash, for a snapshot that fails to decrypt (e.g. wrong key)', async () => {
    setRawBody(
      JSON.stringify({ schemaVersion: 1, iv: 'aXY4NTY3ODkwMQ==', authTag: 'dGFnMTIzNDU2Nzg5MDEy', ciphertext: 'bm90LXJlYWwtY2lwaGVydGV4dA==' }),
      '2026-08-14T00:00:00.000Z',
    )
    const res = await fetch(`${baseUrl}/api/snapshot`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(500)
  })
})
