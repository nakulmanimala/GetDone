import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { createS3UserStore } from './userStore.js'
import type { GoogleIdentity } from './googleAuth.js'

// In-memory S3 with ETag support, so the conditional-write path is exercised
// for real rather than stubbed out. Mirrors snapshotStore.test.ts's approach.
class FakeS3Client {
  private objects = new Map<string, { body: string; etag: string }>()
  private version = 0
  /** Simulates another writer landing between our read and our write. */
  onBeforePut?: () => void

  async send(command: unknown): Promise<unknown> {
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(String(command.input.Key))
      if (!object) {
        const error = new Error('NoSuchKey') as Error & { name: string }
        error.name = 'NoSuchKey'
        throw error
      }
      return { ETag: object.etag, Body: { transformToString: async () => object.body } }
    }

    if (command instanceof PutObjectCommand) {
      this.onBeforePut?.()
      const key = String(command.input.Key)
      const existing = this.objects.get(key)
      const { IfMatch, IfNoneMatch } = command.input as { IfMatch?: string; IfNoneMatch?: string }

      if (IfNoneMatch === '*' && existing) throw preconditionFailed()
      if (IfMatch && existing?.etag !== IfMatch) throw preconditionFailed()

      this.version += 1
      this.objects.set(key, { body: String(command.input.Body), etag: `"v${this.version}"` })
      return {}
    }

    throw new Error('Unsupported command')
  }

  seed(key: string, body: string): void {
    this.version += 1
    this.objects.set(key, { body, etag: `"v${this.version}"` })
  }

  read(key: string): string | undefined {
    return this.objects.get(key)?.body
  }
}

function preconditionFailed(): Error {
  const error = new Error('PreconditionFailed') as Error & { name: string; $metadata: { httpStatusCode: number } }
  error.name = 'PreconditionFailed'
  error.$metadata = { httpStatusCode: 412 }
  return error
}

const KEY = 'getdone/users.json'

function identity(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
  return { sub: 'sub-1', email: 'first@entri.me', name: 'First User', ...overrides }
}

function storeWith(client: FakeS3Client) {
  return createS3UserStore(client as unknown as S3Client, 'bucket', KEY)
}

const at = (iso: string) => () => new Date(iso)

describe('createS3UserStore', () => {
  it('starts empty when the registry object does not exist yet', async () => {
    expect(await storeWith(new FakeS3Client()).list()).toEqual([])
  })

  it('makes the very first user the superuser', async () => {
    const store = storeWith(new FakeS3Client())

    const user = await store.signIn(identity(), at('2026-08-15T10:00:00Z'))

    expect(user).toEqual({
      sub: 'sub-1',
      email: 'first@entri.me',
      name: 'First User',
      role: 'superuser',
      createdAt: '2026-08-15T10:00:00.000Z',
      lastSeenAt: '2026-08-15T10:00:00.000Z',
    })
  })

  it('makes everyone after the first a member', async () => {
    const store = storeWith(new FakeS3Client())

    await store.signIn(identity())
    const second = await store.signIn(identity({ sub: 'sub-2', email: 'second@entri.me', name: 'Second' }))
    const third = await store.signIn(identity({ sub: 'sub-3', email: 'third@entri.me', name: 'Third' }))

    expect(second.role).toBe('member')
    expect(third.role).toBe('member')
    expect((await store.list()).map((user) => user.role)).toEqual(['superuser', 'member', 'member'])
  })

  it('does not promote a returning user, or re-enroll them', async () => {
    const store = storeWith(new FakeS3Client())
    await store.signIn(identity())
    await store.signIn(identity({ sub: 'sub-2', email: 'second@entri.me' }))

    const again = await store.signIn(identity({ sub: 'sub-2', email: 'second@entri.me' }))

    expect(again.role).toBe('member')
    expect(await store.list()).toHaveLength(2)
  })

  it('keeps the superuser role across sign-ins', async () => {
    const store = storeWith(new FakeS3Client())
    await store.signIn(identity(), at('2026-08-15T10:00:00Z'))

    const again = await store.signIn(identity(), at('2026-08-16T10:00:00Z'))

    expect(again.role).toBe('superuser')
    expect(again.createdAt).toBe('2026-08-15T10:00:00.000Z')
    expect(again.lastSeenAt).toBe('2026-08-16T10:00:00.000Z')
  })

  it('refreshes a changed display name or address', async () => {
    const store = storeWith(new FakeS3Client())
    await store.signIn(identity())

    const renamed = await store.signIn(identity({ name: 'Renamed', email: 'new-address@entri.me' }))

    expect(renamed).toMatchObject({ name: 'Renamed', email: 'new-address@entri.me' })
    expect(await store.list()).toHaveLength(1)
  })

  // The race that matters: two people hitting "Sign in" simultaneously on a
  // fresh deployment must not both become superuser.
  it('retries a lost race so only one first user becomes superuser', async () => {
    const client = new FakeS3Client()
    const store = storeWith(client)
    let interfered = false

    client.onBeforePut = () => {
      if (interfered) return
      interfered = true
      // Another node commits a different first user just before our write.
      client.seed(KEY, JSON.stringify({
        users: [{
          sub: 'sub-other',
          email: 'other@entri.me',
          name: 'Other',
          role: 'superuser',
          createdAt: '2026-08-15T09:59:00.000Z',
          lastSeenAt: '2026-08-15T09:59:00.000Z',
        }],
      }))
    }

    const user = await store.signIn(identity())

    expect(user.role).toBe('member')
    const stored = JSON.parse(client.read(KEY) ?? '{}') as { users: { sub: string; role: string }[] }
    expect(stored.users.filter((u) => u.role === 'superuser')).toHaveLength(1)
    expect(stored.users).toHaveLength(2)
  })

  it('gives up rather than looping forever under sustained contention', async () => {
    const client = new FakeS3Client()
    const store = storeWith(client)
    let churn = 0
    client.onBeforePut = () => {
      churn += 1
      client.seed(KEY, JSON.stringify({ users: [{ sub: `churn-${churn}`, role: 'member' }] }))
    }

    await expect(store.signIn(identity())).rejects.toThrow(/concurrent/i)
  })

  it('looks a user up by subject', async () => {
    const store = storeWith(new FakeS3Client())
    await store.signIn(identity())

    expect(await store.get('sub-1')).toMatchObject({ email: 'first@entri.me' })
    expect(await store.get('nobody')).toBeNull()
  })

  it('tolerates a corrupt registry object instead of locking everyone out', async () => {
    const client = new FakeS3Client()
    client.seed(KEY, JSON.stringify({ users: 'not-an-array' }))

    expect(await storeWith(client).list()).toEqual([])
  })
})
