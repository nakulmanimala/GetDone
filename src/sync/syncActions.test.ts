import { beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../domain/tasks'
import { AuthError, type ApiClient, type SnapshotPayload } from './apiClient'
import { applySyncOutcome, backupNow, checkSync, describeSyncError, restoreFromS3, type SyncSession } from './syncActions'
import { getLastSyncedAt, setUpdatedAt } from './syncMeta'

const T1 = '2026-08-14T00:00:00.000Z'

const tasks: Task[] = [
  { id: '1', title: 'Buy milk', status: 'open', project: 'Inbox', priority: 'none', createdAt: T1 },
]

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    fetchMeta: async () => ({ exists: false, updatedAt: null }),
    fetchSnapshot: async () => null,
    putSnapshot: async () => {},
    ...overrides,
  }
}

describe('syncActions', () => {
  let session: SyncSession

  beforeEach(() => {
    localStorage.clear()
    session = { api: fakeApi() }
  })

  it('checkSync pushes on first-ever backup', async () => {
    setUpdatedAt(T1)
    let pushedPayload: SnapshotPayload | undefined
    session.api = fakeApi({ putSnapshot: async (payload) => { pushedPayload = payload } })

    const outcome = await checkSync(session, tasks)

    expect(outcome.status).toBe('pushed')
    expect(pushedPayload?.updatedAt).toBe(T1)
  })

  it('backupNow uploads the current tasks and stamps lastSyncedAt', async () => {
    setUpdatedAt(T1)
    let pushedPayload: SnapshotPayload | undefined
    session.api = fakeApi({ putSnapshot: async (payload) => { pushedPayload = payload } })

    const updatedAt = await backupNow(session, tasks)

    expect(updatedAt).toBe(T1)
    expect(pushedPayload).toEqual({ updatedAt: T1, tasks })
    expect(getLastSyncedAt()).toBe(T1)
  })

  it('restoreFromS3 returns the remote snapshot and stamps lastSyncedAt', async () => {
    const payload: SnapshotPayload = { updatedAt: T1, tasks }
    session.api = fakeApi({ fetchSnapshot: async () => payload })

    const result = await restoreFromS3(session)

    expect(result).toEqual({ tasks, updatedAt: T1 })
    expect(getLastSyncedAt()).toBe(T1)
  })

  it('restoreFromS3 returns null when no snapshot exists', async () => {
    expect(await restoreFromS3(session)).toBeNull()
  })

  it('applySyncOutcome applies a pulled snapshot and returns a done status', () => {
    let applied: { tasks: Task[]; updatedAt: string } | undefined
    const status = applySyncOutcome(
      { status: 'pulled', tasksJson: JSON.stringify(tasks), updatedAt: T1 },
      { onApplyRemoteSnapshot: (t, updatedAt) => { applied = { tasks: t, updatedAt } } },
    )

    expect(status).toEqual({ kind: 'done', label: 'Restored from S3.' })
    expect(applied).toEqual({ tasks, updatedAt: T1 })
    expect(getLastSyncedAt()).toBe(T1)
  })

  it('applySyncOutcome surfaces a conflict without applying anything', () => {
    const status = applySyncOutcome(
      { status: 'conflict', localUpdatedAt: T1, remoteUpdatedAt: T1 },
      { onApplyRemoteSnapshot: () => { throw new Error('should not be called') } },
    )
    expect(status).toEqual({ kind: 'conflict', localUpdatedAt: T1, remoteUpdatedAt: T1 })
  })

  it('applySyncOutcome stamps lastSyncedAt from the current watermark on push', () => {
    setUpdatedAt(T1)
    const status = applySyncOutcome({ status: 'pushed' }, { onApplyRemoteSnapshot: () => {} })
    expect(status).toEqual({ kind: 'done', label: 'Backed up to S3.' })
    expect(getLastSyncedAt()).toBe(T1)
  })

  it('describeSyncError maps known error types to friendly messages', () => {
    expect(describeSyncError(new AuthError('nope'))).toMatch(/token was rejected/)
    expect(describeSyncError(new Error('boom'))).toBe('boom')
    expect(describeSyncError('not an error')).toBe('Something went wrong.')
  })
})
