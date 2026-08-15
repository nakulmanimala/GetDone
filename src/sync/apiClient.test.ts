import { describe, expect, it } from 'vitest'
import { AuthError, NotFoundError, ServerError, createApiClient, type SnapshotPayload } from './apiClient'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const payload: SnapshotPayload = {
  updatedAt: '2026-08-14T00:00:00.000Z',
  tasks: [{ id: '1', title: 'Buy milk' }],
}

describe('createApiClient', () => {
  // Identity now travels in an httpOnly session cookie, which the browser
  // only attaches when credentials are requested.
  it('sends the session cookie and no bearer header', async () => {
    let captured: RequestInit | undefined
    const client = createApiClient({
      fetchFn: async (_url, init) => {
        captured = init
        return jsonResponse(200, { exists: false, updatedAt: null })
      },
    })

    await client.fetchMeta()

    expect(captured?.credentials).toBe('same-origin')
    expect((captured?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined()
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

  it('fetchSnapshot returns the payload on success', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(200, payload) })
    expect(await client.fetchSnapshot()).toEqual(payload)
  })

  it('throws AuthError on 401', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(401, { error: 'Unauthorized' }) })
    await expect(client.fetchMeta()).rejects.toBeInstanceOf(AuthError)
  })

  it('throws ServerError on unexpected status codes', async () => {
    const client = createApiClient({ fetchFn: async () => jsonResponse(500, { error: 'boom' }) })
    await expect(client.fetchMeta()).rejects.toBeInstanceOf(ServerError)
  })

  it('putSnapshot sends the payload as the request body', async () => {
    let capturedBody: string | null = null
    const client = createApiClient({
      fetchFn: async (_url, init) => {
        capturedBody = init?.body as string
        return jsonResponse(200, { ok: true })
      },
    })

    await client.putSnapshot(payload)
    expect(JSON.parse(capturedBody!)).toEqual(payload)
  })

  it('NotFoundError is exported for other call sites to distinguish 404s', () => {
    expect(new NotFoundError('x')).toBeInstanceOf(Error)
  })
})
