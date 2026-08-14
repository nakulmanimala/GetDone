import { describe, expect, it } from 'vitest'
import {
  decideSyncAction,
  pullSnapshot,
  pushSnapshot,
  runSync,
  type LocalSyncState,
  type PullDeps,
  type PushDeps,
} from './snapshotSync'
import type { SnapshotMeta, SnapshotPayload } from './apiClient'

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
  it('puts the parsed tasks alongside the updatedAt watermark', async () => {
    let putPayload: SnapshotPayload | undefined
    const deps: PushDeps = {
      putSnapshot: async (payload) => {
        putPayload = payload
      },
    }

    await pushSnapshot(deps, '[{"id":"1"}]', T1)

    expect(putPayload).toEqual({ updatedAt: T1, tasks: [{ id: '1' }] })
  })
})

describe('pullSnapshot', () => {
  it('returns null when no snapshot exists', async () => {
    const deps: PullDeps = { fetchSnapshot: async () => null }
    expect(await pullSnapshot(deps)).toBeNull()
  })

  it('stringifies the fetched tasks', async () => {
    const payload: SnapshotPayload = { updatedAt: T1, tasks: [{ id: '1' }] }
    const deps: PullDeps = { fetchSnapshot: async () => payload }

    expect(await pullSnapshot(deps)).toEqual({ tasksJson: '[{"id":"1"}]', updatedAt: T1 })
  })
})

describe('runSync', () => {
  function baseDeps(overrides: Partial<Parameters<typeof runSync>[0]> = {}) {
    return {
      fetchMeta: async (): Promise<SnapshotMeta> => ({ exists: false, updatedAt: null }),
      putSnapshot: async () => {},
      fetchSnapshot: async () => null,
      local: { updatedAt: T1, lastSyncedAt: null } as LocalSyncState,
      tasksJson: '[{"id":"1"}]',
      now: () => new Date(T1),
      ...overrides,
    }
  }

  it('pushes on first-ever backup', async () => {
    let pushed: SnapshotPayload | undefined
    const outcome = await runSync(baseDeps({ putSnapshot: async (payload) => { pushed = payload } }))
    expect(outcome).toEqual({ status: 'pushed' })
    expect(pushed?.updatedAt).toBe(T1)
  })

  it('pulls and returns tasks when only remote changed', async () => {
    const payload: SnapshotPayload = { updatedAt: T1, tasks: [{ id: 'remote' }] }
    const outcome = await runSync(
      baseDeps({
        local: { updatedAt: T0, lastSyncedAt: T0 },
        fetchMeta: async () => ({ exists: true, updatedAt: T1 }),
        fetchSnapshot: async () => payload,
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
