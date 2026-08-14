import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './server'
import type { Snapshot, SnapshotMeta, SnapshotStore } from './snapshotStore'

function createFakeStore(): SnapshotStore {
  let stored: Snapshot | null = null
  return {
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
}

const TOKEN = 'test-token'
let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer(createApp(createFakeStore(), TOKEN))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const envelope = {
  schemaVersion: 1,
  kdfName: 'PBKDF2-SHA256',
  kdfIterations: 250_000,
  salt: 'c2FsdA==',
  iv: 'aXY=',
  updatedAt: '2026-08-14T00:00:00.000Z',
  ciphertext: 'Y2lwaGVydGV4dA==',
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

  it('round-trips a snapshot through PUT and GET', async () => {
    const putRes = await fetch(`${baseUrl}/api/snapshot`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    expect(putRes.status).toBe(200)

    const getRes = await fetch(`${baseUrl}/api/snapshot`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(await getRes.json()).toEqual(envelope)

    const metaRes = await fetch(`${baseUrl}/api/snapshot/meta`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(await metaRes.json()).toEqual({ exists: true, updatedAt: envelope.updatedAt })
  })

  it('rejects a malformed envelope with 400', async () => {
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
})
