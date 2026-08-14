import { getApiToken } from './syncMeta'

export class AuthError extends Error {}
export class NotFoundError extends Error {}
export class NetworkError extends Error {}
export class ServerError extends Error {}

export interface SnapshotEnvelope {
  schemaVersion: number
  kdfName: string
  kdfIterations: number
  salt: string
  iv: string
  updatedAt: string
  ciphertext: string
}

export interface SnapshotMeta {
  exists: boolean
  updatedAt: string | null
}

export interface ApiClient {
  fetchMeta(): Promise<SnapshotMeta>
  fetchSnapshot(): Promise<SnapshotEnvelope | null>
  putSnapshot(envelope: SnapshotEnvelope): Promise<void>
}

export interface ApiClientDeps {
  fetchFn?: typeof fetch
  getToken?: () => string | null
}

export function createApiClient({ fetchFn = fetch, getToken = getApiToken }: ApiClientDeps = {}): ApiClient {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = getToken()
    let response: Response
    try {
      response = await fetchFn(`/api${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token ?? ''}` },
      })
    } catch (error) {
      throw new NetworkError('Could not reach the sync server.', { cause: error })
    }

    if (response.status === 401) throw new AuthError('The sync token was rejected.')
    if (response.status === 404) throw new NotFoundError('No snapshot found.')
    if (!response.ok) throw new ServerError(`Sync server returned status ${response.status}.`)
    return response
  }

  return {
    async fetchMeta() {
      const response = await request('/snapshot/meta')
      return (await response.json()) as SnapshotMeta
    },
    async fetchSnapshot() {
      try {
        const response = await request('/snapshot')
        return (await response.json()) as SnapshotEnvelope
      } catch (error) {
        if (error instanceof NotFoundError) return null
        throw error
      }
    },
    async putSnapshot(envelope) {
      await request('/snapshot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      })
    },
  }
}
