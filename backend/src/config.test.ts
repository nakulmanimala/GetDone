import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('throws when S3_BUCKET is missing', () => {
    expect(() => loadConfig({ SYNC_API_TOKEN: 'token' })).toThrow(/S3_BUCKET/)
  })

  it('throws when SYNC_API_TOKEN is missing', () => {
    expect(() => loadConfig({ S3_BUCKET: 'bucket' })).toThrow(/SYNC_API_TOKEN/)
  })

  it('applies defaults for optional fields', () => {
    const config = loadConfig({ S3_BUCKET: 'bucket', SYNC_API_TOKEN: 'token' })
    expect(config.port).toBe(8081)
    expect(config.s3SnapshotKey).toBe('getdone/snapshot.json.enc')
  })

  it('respects overrides', () => {
    const config = loadConfig({
      S3_BUCKET: 'bucket',
      SYNC_API_TOKEN: 'token',
      PORT: '9000',
      S3_SNAPSHOT_KEY: 'custom/key.json',
    })
    expect(config.port).toBe(9000)
    expect(config.s3SnapshotKey).toBe('custom/key.json')
  })

  it('falls back to the default port on an invalid PORT value', () => {
    const config = loadConfig({ S3_BUCKET: 'bucket', SYNC_API_TOKEN: 'token', PORT: 'not-a-number' })
    expect(config.port).toBe(8081)
  })
})
