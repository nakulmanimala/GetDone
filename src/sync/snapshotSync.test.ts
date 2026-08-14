import { describe, expect, it } from 'vitest'
import {
  decideSyncAction,
  pullSnapshot,
  pushSnapshot,
  runSync,
  type EncryptedPullDeps,
  type EncryptedPushDeps,
  type LocalSyncState,
} from './snapshotSync'
import type { SnapshotEnvelope, SnapshotMeta } from './apiClient'

const T0 = '2026-08-01T00:00:00.000Z'
const T1 = '2026-08-14T00:00:00.000Z'

describe('decideSyncAction', () => {
  it('pushes when no remote snapshot exists yet', () => {
    const local: LocalSyncState = { updatedAt: T1, lastSyncedAt: null }
    const remote: SnapshotMeta = { exists: false, updatedAt: null }
    expect(decideSyncAction(local, remote)).toBe('push')
  })

  it('pulls when only the remote changed since last sync', () => {
    const local: LocalSyncState = { updatedAt: T0, lastSyncedAt: T0 }
    const remote: SnapshotMeta = { exists: true, updatedAt: T1 }
    expect(decideSyncAction(local, remote)).toBe('pull')
  })

  it('pushes when only local changed since last sync', () => {
    const local: LocalSyncState = { updatedAt: T1, lastSyncedAt: T0 }
    const remote: SnapshotMeta = { exists: true, updatedAt: T0 }
    expect(decideSyncAction(local, remote)).toBe('push')
  })

  it('flags a conflict when both local and remote changed since last sync', () => {
    const local: LocalSyncState = { updatedAt: T1, lastSyncedAt: T0 }
    const remote: SnapshotMeta = { exists: true, updatedAt: T1 }
    expect(decideSyncAction(local, remote)).toBe('conflict')
  })

  it('is up-to-date when neither side changed since last sync', () => {
    const local: LocalSyncState = { updatedAt: T0, lastSyncedAt: T0 }
    const remote: SnapshotMeta = { exists: true, updatedAt: T0 }
    expect(decideSyncAction(local, remote)).toBe('up-to-date')
  })

  it('treats a never-synced local with existing remote data as a conflict', () => {
    const local: LocalSyncState = { updatedAt: T1, lastSyncedAt: null }
    const remote: SnapshotMeta = { exists: true, updatedAt: T0 }
    expect(decideSyncAction(local, remote)).toBe('conflict')
  })
})

describe('pushSnapshot', () => {
  it('encrypts the tasks json and puts the resulting envelope', async () => {
    let putEnvelope: SnapshotEnvelope | undefined
    const deps: EncryptedPushDeps = {
      putSnapshot: async (envelope) => {
        putEnvelope = envelope
      },
      encrypt: async (plaintext) => ({ ciphertext: `enc(${plaintext})`, iv: 'fake-iv' }),
      saltBase64: 'fake-salt',
      kdfIterations: 250_000,
    }

    await pushSnapshot(deps, '[{"id":"1"}]', T1)

    expect(putEnvelope).toEqual({
      schemaVersion: 1,
      kdfName: 'PBKDF2-SHA256',
      kdfIterations: 250_000,
      salt: 'fake-salt',
      iv: 'fake-iv',
      updatedAt: T1,
      ciphertext: 'enc([{"id":"1"}])',
    })
  })
})

describe('pullSnapshot', () => {
  it('returns null when no snapshot exists', async () => {
    const deps: EncryptedPullDeps = {
      fetchSnapshot: async () => null,
      decrypt: async () => {
        throw new Error('should not be called')
      },
    }
    expect(await pullSnapshot(deps)).toBeNull()
  })

  it('decrypts the fetched envelope', async () => {
    const envelope: SnapshotEnvelope = {
      schemaVersion: 1,
      kdfName: 'PBKDF2-SHA256',
      kdfIterations: 250_000,
      salt: 'fake-salt',
      iv: 'fake-iv',
      updatedAt: T1,
      ciphertext: 'enc([{"id":"1"}])',
    }
    const deps: EncryptedPullDeps = {
      fetchSnapshot: async () => envelope,
      decrypt: async (ciphertext) => ciphertext.replace('enc(', '').replace(')', ''),
    }

    expect(await pullSnapshot(deps)).toEqual({ tasksJson: '[{"id":"1"}]', updatedAt: T1 })
  })
})

describe('runSync', () => {
  function baseDeps(overrides: Partial<Parameters<typeof runSync>[0]> = {}) {
    return {
      fetchMeta: async (): Promise<SnapshotMeta> => ({ exists: false, updatedAt: null }),
      putSnapshot: async () => {},
      encrypt: async (plaintext: string) => ({ ciphertext: `enc(${plaintext})`, iv: 'fake-iv' }),
      fetchSnapshot: async () => null,
      decrypt: async (ciphertext: string) => ciphertext.replace('enc(', '').replace(')', ''),
      saltBase64: 'fake-salt',
      kdfIterations: 250_000,
      local: { updatedAt: T1, lastSyncedAt: null } as LocalSyncState,
      tasksJson: '[{"id":"1"}]',
      now: () => new Date(T1),
      ...overrides,
    }
  }

  it('pushes on first-ever backup', async () => {
    let pushed: SnapshotEnvelope | undefined
    const outcome = await runSync(baseDeps({ putSnapshot: async (envelope) => { pushed = envelope } }))
    expect(outcome).toEqual({ status: 'pushed' })
    expect(pushed?.updatedAt).toBe(T1)
  })

  it('pulls and returns decrypted tasks when only remote changed', async () => {
    const envelope: SnapshotEnvelope = {
      schemaVersion: 1,
      kdfName: 'PBKDF2-SHA256',
      kdfIterations: 250_000,
      salt: 'fake-salt',
      iv: 'fake-iv',
      updatedAt: T1,
      ciphertext: 'enc([{"id":"remote"}])',
    }
    const outcome = await runSync(
      baseDeps({
        local: { updatedAt: T0, lastSyncedAt: T0 },
        fetchMeta: async () => ({ exists: true, updatedAt: T1 }),
        fetchSnapshot: async () => envelope,
      }),
    )
    expect(outcome).toEqual({ status: 'pulled', tasksJson: '[{"id":"remote"}]', updatedAt: T1 })
  })

  it('returns conflict without pushing or pulling when both sides changed', async () => {
    let putCalled = false
    let getCalled = false
    const outcome = await runSync(
      baseDeps({
        local: { updatedAt: T1, lastSyncedAt: T0 },
        fetchMeta: async () => ({ exists: true, updatedAt: T1 }),
        putSnapshot: async () => { putCalled = true },
        fetchSnapshot: async () => { getCalled = true; return null },
      }),
    )
    expect(outcome).toEqual({ status: 'conflict', localUpdatedAt: T1, remoteUpdatedAt: T1 })
    expect(putCalled).toBe(false)
    expect(getCalled).toBe(false)
  })

  it('reports up-to-date when neither side changed', async () => {
    const outcome = await runSync(
      baseDeps({
        local: { updatedAt: T0, lastSyncedAt: T0 },
        fetchMeta: async () => ({ exists: true, updatedAt: T0 }),
      }),
    )
    expect(outcome).toEqual({ status: 'up-to-date' })
  })
})
