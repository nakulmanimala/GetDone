import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'

export interface SnapshotMeta {
  exists: boolean
  updatedAt: string | null
}

export interface Snapshot {
  body: string
  updatedAt: string | null
}

export interface SnapshotStore {
  head(): Promise<SnapshotMeta>
  get(): Promise<Snapshot | null>
  put(body: string, updatedAt: string): Promise<void>
}

/**
 * Opens a store over one object. Callers bind the key per request from the
 * signed-in user's id, which is what isolates one teammate's tasks from
 * another's — see snapshotKeyFor in config.ts.
 */
export function createS3SnapshotStore(client: S3Client, bucket: string, key: string): SnapshotStore {
  return {
    async head() {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return { exists: true, updatedAt: result.Metadata?.['updated-at'] ?? null }
      } catch (error) {
        if (isNotFound(error)) return { exists: false, updatedAt: null }
        throw error
      }
    },
    async get() {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        const body = await result.Body?.transformToString()
        if (body === undefined) return null
        return { body, updatedAt: result.Metadata?.['updated-at'] ?? null }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async put(body, updatedAt) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          Metadata: { 'updated-at': updatedAt },
        }),
      )
    },
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === 'NotFound' || name === 'NoSuchKey'
}
