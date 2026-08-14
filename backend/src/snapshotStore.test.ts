import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { createS3SnapshotStore } from './snapshotStore'

// A hand-written in-memory fake standing in for S3 — no real network calls,
// no mocking library, mirroring this repo's existing testing conventions.
class FakeS3Client {
  private objects = new Map<string, { body: string; metadata: Record<string, string> }>()

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      const { Bucket, Key, Body, Metadata } = command.input
      this.objects.set(`${Bucket}/${Key}`, { body: String(Body), metadata: Metadata ?? {} })
      return {}
    }
    if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
      const { Bucket, Key } = command.input
      const object = this.objects.get(`${Bucket}/${Key}`)
      if (!object) {
        const error = new Error('NotFound') as Error & { name: string }
        error.name = 'NotFound'
        throw error
      }
      if (command instanceof HeadObjectCommand) {
        return { Metadata: object.metadata }
      }
      return { Metadata: object.metadata, Body: { transformToString: async () => object.body } }
    }
    throw new Error('Unsupported command')
  }
}

describe('createS3SnapshotStore', () => {
  it('reports not-exists before any put', async () => {
    const store = createS3SnapshotStore(new FakeS3Client() as unknown as S3Client, 'bucket', 'key')
    expect(await store.head()).toEqual({ exists: false, updatedAt: null })
    expect(await store.get()).toBeNull()
  })

  it('round-trips a put through head and get', async () => {
    const store = createS3SnapshotStore(new FakeS3Client() as unknown as S3Client, 'bucket', 'key')
    await store.put('{"a":1}', '2026-08-14T00:00:00.000Z')
    expect(await store.head()).toEqual({ exists: true, updatedAt: '2026-08-14T00:00:00.000Z' })
    expect(await store.get()).toEqual({ body: '{"a":1}', updatedAt: '2026-08-14T00:00:00.000Z' })
  })

  it('scopes objects by bucket and key', async () => {
    const client = new FakeS3Client() as unknown as S3Client
    const storeA = createS3SnapshotStore(client, 'bucket', 'key-a')
    const storeB = createS3SnapshotStore(client, 'bucket', 'key-b')
    await storeA.put('{"a":1}', '2026-08-14T00:00:00.000Z')
    expect(await storeB.head()).toEqual({ exists: false, updatedAt: null })
  })
})
