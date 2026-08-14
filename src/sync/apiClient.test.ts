import { describe, expect, it } from 'vitest'
import { AuthError, NotFoundError, ServerError, createApiClient, type SnapshotEnvelope } from './apiClient'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const envelope: SnapshotEnvelope = {
  schemaVersion: 1,
  kdfName: 'PBKDF2-SHA256',
  kdfIterations: 250_000,
  salt: 'c2FsdA==',
  iv: 'aXY=',
  updatedAt: '2026-08-14T00:00:00.000Z',
  ciphertext: 'Y2lwaGVydGV4dA==',
}

describe('createApiClient', () => {
  it('sends the token as a bearer header on every request', async () => {
    let capturedAuth: string | null = null
    const client = createApiClient({
      getToken: () => 'my-token',
      fetchFn: async (_url, init) => {
        capturedAuth = (init!.headers as Record<string, string>).Authorization
        return jsonResponse(200, { exists: false, updatedAt: null })
      },
    })

    await client.fetchMeta()
    expect(capturedAuth).toBe('Bearer my-token')
  })

  it('fetchMeta returns the parsed meta payload', async () => {
    const client = createApiClient({
      fetchFn: async () => jsonResponse(200, { exists: true, updatedAt: '2026-08-14T00:00:00.000Z' }),
    })
    expect(await client.fetchMeta()).toEqual({ exists: true, updatedAt: '2026-08-14T00:00:00.000Z' })
  })

  it('fetchSnapshot returns null on 404 instead of throwing', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(404, { error: 'No snapshot found' }) })
    expect(await client.fetchSnapshot()).toBeNull()
  })

  it('fetchSnapshot returns the envelope on success', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(200, envelope) })
    expect(await client.fetchSnapshot()).toEqual(envelope)
  })

  it('throws AuthError on 401', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(401, { error: 'Unauthorized' }) })
    await expect(client.fetchMeta()).rejects.toBeInstanceOf(AuthError)
  })

  it('throws ServerError on unexpected status codes', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(500, { error: 'boom' }) })
    await expect(client.fetchMeta()).rejects.toBeInstanceOf(ServerError)
  })

  it('putSnapshot sends the envelope as the request body', async () => {
    let capturedBody: string | null = null
    const client = createApiClient({
      fetchFn: async (_url, init) => {
        capturedBody = init?.body as string
        return jsonResponse(200, { ok: true })
      },
    })

    await client.putSnapshot(envelope)
    expect(JSON.parse(capturedBody!)).toEqual(envelope)
  })

  it('NotFoundError is exported for other call sites to distinguish 404s', () => {
    expect(new NotFoundError('x')).toBeInstanceOf(Error)
  })
})
