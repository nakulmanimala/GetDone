import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import type { GoogleIdentity } from './googleAuth.js'

export type Role = 'superuser' | 'member'

export interface User {
  /** Google's stable subject id. Also the S3 namespace for the user's tasks. */
  sub: string
  email: string
  name: string
  role: Role
  createdAt: string
  lastSeenAt: string
}

export interface UserRegistry {
  users: User[]
}

export interface UserStore {
  list(): Promise<User[]>
  /** Signs a Google identity in, enrolling them on first sight. */
  signIn(identity: GoogleIdentity, now?: () => Date): Promise<User>
  get(sub: string): Promise<User | null>
}

interface StoredRegistry {
  registry: UserRegistry
  etag: string | null
}

/** How many times to retry a lost race before giving up. */
const MAX_WRITE_ATTEMPTS = 5

export class ConcurrentUpdateError extends Error {}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === 'NotFound' || name === 'NoSuchKey'
}

function isPreconditionFailed(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
  return name === 'PreconditionFailed' || status === 412 || status === 409
}

export function createS3UserStore(client: S3Client, bucket: string, key: string): UserStore {
  async function read(): Promise<StoredRegistry> {
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const body = await result.Body?.transformToString()
      if (!body) return { registry: { users: [] }, etag: result.ETag ?? null }
      const parsed = JSON.parse(body) as Partial<UserRegistry>
      return {
        registry: { users: Array.isArray(parsed.users) ? parsed.users : [] },
        etag: result.ETag ?? null,
      }
    } catch (error) {
      if (isNotFound(error)) return { registry: { users: [] }, etag: null }
      throw error
    }
  }

  // Conditional writes turn read-modify-write into an atomic compare-and-swap.
  // Without this, two people signing up at the same instant could both read an
  // empty registry and both be written as superuser (or one could vanish).
  async function write(registry: UserRegistry, etag: string | null): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(registry, null, 2),
        ContentType: 'application/json',
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
      }),
    )
  }

  async function mutate(apply: (registry: UserRegistry) => User): Promise<User> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const { registry, etag } = await read()
      const user = apply(registry)
      try {
        await write(registry, etag)
        return user
      } catch (error) {
        if (!isPreconditionFailed(error)) throw error
        // Someone else wrote first; re-read and reapply against their version.
      }
    }
    throw new ConcurrentUpdateError('Could not update the user registry; too many concurrent sign-ins')
  }

  return {
    async list() {
      return (await read()).registry.users
    },

    async get(sub) {
      return (await read()).registry.users.find((user) => user.sub === sub) ?? null
    },

    async signIn(identity, now = () => new Date()) {
      return mutate((registry) => {
        const timestamp = now().toISOString()
        const existing = registry.users.find((user) => user.sub === identity.sub)

        if (existing) {
          // Refresh the profile: people change their display name, and a
          // Workspace admin can reassign an address.
          existing.email = identity.email
          existing.name = identity.name
          existing.lastSeenAt = timestamp
          return existing
        }

        const user: User = {
          sub: identity.sub,
          email: identity.email,
          name: identity.name,
          // Whoever signs up first owns the deployment.
          role: registry.users.length === 0 ? 'superuser' : 'member',
          createdAt: timestamp,
          lastSeenAt: timestamp,
        }
        registry.users.push(user)
        return user
      })
    },
  }
}
