import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadConfig, snapshotKeyFor } from './config.js'

const VALID_KEY = randomBytes(32).toString('base64')
const SECRET = 'x'.repeat(32)

const base = {
  S3_BUCKET: 'bucket',
  SYNC_ENCRYPTION_KEY: VALID_KEY,
  SESSION_SECRET: SECRET,
  APP_ORIGIN: 'https://tasks.entri.me',
  GOOGLE_CLIENT_ID: 'client-123',
  GOOGLE_CLIENT_SECRET: 'client-secret',
}

const without = (key: keyof typeof base) => {
  const env: Record<string, string | undefined> = { ...base }
  delete env[key]
  return env
}

describe('loadConfig', () => {
  it.each([
    ['S3_BUCKET', /S3_BUCKET/],
    ['SYNC_ENCRYPTION_KEY', /SYNC_ENCRYPTION_KEY/],
    ['SESSION_SECRET', /SESSION_SECRET/],
    ['APP_ORIGIN', /APP_ORIGIN/],
    ['GOOGLE_CLIENT_ID', /GOOGLE_CLIENT_ID/],
    ['GOOGLE_CLIENT_SECRET', /GOOGLE_CLIENT_SECRET/],
  ] as const)('refuses to start without %s', (key, pattern) => {
    expect(() => loadConfig(without(key))).toThrow(pattern)
  })

  it('rejects an encryption key that does not decode to 32 bytes', () => {
    expect(() => loadConfig({ ...base, SYNC_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/)
  })

  it('rejects a session secret short enough to brute force', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/at least 32/)
  })

  it('rejects a non-absolute APP_ORIGIN', () => {
    expect(() => loadConfig({ ...base, APP_ORIGIN: 'tasks.entri.me' })).toThrow(/absolute URL/)
  })

  // Google refuses plain-http redirect URIs off localhost, and the session
  // cookie would ride unprotected — better to fail at boot than in production.
  it('rejects plain http except on localhost', () => {
    expect(() => loadConfig({ ...base, APP_ORIGIN: 'http://tasks.entri.me' })).toThrow(/https/)
    expect(loadConfig({ ...base, APP_ORIGIN: 'http://localhost:3080' }).appOrigin).toBe('http://localhost:3080')
    expect(loadConfig({ ...base, APP_ORIGIN: 'http://127.0.0.1:3080' }).appOrigin).toBe('http://127.0.0.1:3080')
  })

  it('trims a trailing slash off APP_ORIGIN so the redirect URI stays exact', () => {
    expect(loadConfig({ ...base, APP_ORIGIN: 'https://tasks.entri.me/' }).appOrigin).toBe('https://tasks.entri.me')
  })

  it('applies defaults for optional fields', () => {
    const config = loadConfig(base)
    expect(config.port).toBe(8081)
    expect(config.s3SnapshotPrefix).toBe('getdone/users')
    expect(config.s3UsersKey).toBe('getdone/users.json')
    expect(config.allowedDomain).toBe('entri.me')
    expect(config.sessionTtlSeconds).toBe(30 * 24 * 60 * 60)
    expect(config.encryptionKey).toHaveLength(32)
  })

  it('respects overrides', () => {
    const config = loadConfig({
      ...base,
      PORT: '9000',
      S3_SNAPSHOT_PREFIX: 'custom/people',
      S3_USERS_KEY: 'custom/users.json',
      GOOGLE_ALLOWED_DOMAIN: 'example.com',
      SESSION_TTL_SECONDS: '3600',
    })
    expect(config.port).toBe(9000)
    expect(config.s3SnapshotPrefix).toBe('custom/people')
    expect(config.s3UsersKey).toBe('custom/users.json')
    expect(config.allowedDomain).toBe('example.com')
    expect(config.sessionTtlSeconds).toBe(3600)
  })

  it('falls back to defaults on unparseable numbers', () => {
    const config = loadConfig({ ...base, PORT: 'not-a-number', SESSION_TTL_SECONDS: '-5' })
    expect(config.port).toBe(8081)
    expect(config.sessionTtlSeconds).toBe(30 * 24 * 60 * 60)
  })
})

describe('snapshotKeyFor', () => {
  it('namespaces a snapshot under the user id', () => {
    expect(snapshotKeyFor('getdone/users', '1001')).toBe('getdone/users/1001/snapshot.json.enc')
  })

  it('tolerates a trailing slash on the prefix', () => {
    expect(snapshotKeyFor('getdone/users/', '1001')).toBe('getdone/users/1001/snapshot.json.enc')
  })

  // A key built from an unvalidated id would let a crafted sub escape the
  // user's own prefix and reach a teammate's object.
  it.each(['../1002', 'a/b', '..', '', 'id with space', 'id.with.dot'])(
    'refuses the unsafe user id %j',
    (sub) => {
      expect(() => snapshotKeyFor('getdone/users', sub)).toThrow(/Invalid user id/)
    },
  )
})
