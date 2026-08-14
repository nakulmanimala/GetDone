import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const VALID_KEY = randomBytes(32).toString('base64')

describe('loadConfig', () => {
  it('throws when S3_BUCKET is missing', () => {
    expect(() => loadConfig({ SYNC_API_TOKEN: 'token', SYNC_ENCRYPTION_KEY: VALID_KEY })).toThrow(/S3_BUCKET/)
  })

  it('throws when SYNC_API_TOKEN is missing', () => {
    expect(() => loadConfig({ S3_BUCKET: 'bucket', SYNC_ENCRYPTION_KEY: VALID_KEY })).toThrow(/SYNC_API_TOKEN/)
  })

  it('throws when SYNC_ENCRYPTION_KEY is missing', () => {
    expect(() => loadConfig({ S3_BUCKET: 'bucket', SYNC_API_TOKEN: 'token' })).toThrow(/SYNC_ENCRYPTION_KEY/)
  })

  it('throws when SYNC_ENCRYPTION_KEY does not decode to 32 bytes', () => {
    const shortKey = Buffer.alloc(16).toString('base64')
    expect(() =>
      loadConfig({ S3_BUCKET: 'bucket', SYNC_API_TOKEN: 'token', SYNC_ENCRYPTION_KEY: shortKey }),
    ).toThrow(/32 bytes/)
  })

  it('applies defaults for optional fields', () => {
    const config = loadConfig({ S3_BUCKET: 'bucket', SYNC_API_TOKEN: 'token', SYNC_ENCRYPTION_KEY: VALID_KEY })
    expect(config.port).toBe(8081)
    expect(config.s3SnapshotKey).toBe('getdone/snapshot.json.enc')
    expect(config.encryptionKey).toHaveLength(32)
  })

  it('respects overrides', () => {
    const config = loadConfig({
      S3_BUCKET: 'bucket',
      SYNC_API_TOKEN: 'token',
      SYNC_ENCRYPTION_KEY: VALID_KEY,
      PORT: '9000',
      S3_SNAPSHOT_KEY: 'custom/key.json',
    })
    expect(config.port).toBe(9000)
    expect(config.s3SnapshotKey).toBe('custom/key.json')
  })

  it('falls back to the default port on an invalid PORT value', () => {
    const config = loadConfig({
      S3_BUCKET: 'bucket',
      SYNC_API_TOKEN: 'token',
      SYNC_ENCRYPTION_KEY: VALID_KEY,
      PORT: 'not-a-number',
    })
    expect(config.port).toBe(8081)
  })
})
