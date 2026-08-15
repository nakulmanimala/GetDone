export class AuthError extends Error {}
export class NotFoundError extends Error {}
export class NetworkError extends Error {}
export class ServerError extends Error {}

export interface SnapshotPayload {
  updatedAt: string
  tasks: unknown
}

export interface SnapshotMeta {
  exists: boolean
  updatedAt: string | null
}

export interface ApiClient {
  fetchMeta(): Promise<SnapshotMeta>
  fetchSnapshot(): Promise<SnapshotPayload | null>
  putSnapshot(payload: SnapshotPayload): Promise<void>
}

export interface ApiClientDeps {
  fetchFn?: typeof fetch
}

// Requests carry the httpOnly session cookie rather than a bearer token; the
// backend derives which snapshot to touch from that session, so there is no
// user identifier for the client to get wrong (or tamper with).
export function createApiClient({ fetchFn = fetch }: ApiClientDeps = {}): ApiClient {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    try {
      response = await fetchFn(`/api${path}`, { ...init, credentials: 'same-origin' })
    } catch (error) {
      throw new NetworkError('Could not reach the sync server.', { cause: error })
    }

    if (response.status === 401) throw new AuthError('Your session has expired. Please sign in again.')
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
        return (await response.json()) as SnapshotPayload
      } catch (error) {
        if (error instanceof NotFoundError) return null
        throw error
      }
    },
    async putSnapshot(payload) {
      await request('/snapshot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}
