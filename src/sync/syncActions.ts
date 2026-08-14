import type { Task } from '../domain/tasks'
import { AuthError, NetworkError, ServerError, type ApiClient } from './apiClient'
import {
  pullSnapshot,
  pushSnapshot,
  runSync,
  type PullDeps,
  type PushDeps,
  type SyncOutcome,
} from './snapshotSync'
import { getLastSyncedAt, getUpdatedAt, setLastSyncedAt } from './syncMeta'
import type { SyncStatus } from './syncStatus'

export interface SyncSession {
  api: ApiClient
}

function pushDeps({ api }: SyncSession): PushDeps {
  return { putSnapshot: (payload) => api.putSnapshot(payload) }
}

function pullDeps({ api }: SyncSession): PullDeps {
  return { fetchSnapshot: () => api.fetchSnapshot() }
}

export function checkSync(session: SyncSession, tasks: Task[]): Promise<SyncOutcome> {
  return runSync({
    ...pushDeps(session),
    ...pullDeps(session),
    fetchMeta: () => session.api.fetchMeta(),
    local: { updatedAt: getUpdatedAt(), lastSyncedAt: getLastSyncedAt() },
    tasksJson: JSON.stringify(tasks),
  })
}

export async function backupNow(session: SyncSession, tasks: Task[]): Promise<string> {
  const updatedAt = getUpdatedAt() ?? new Date().toISOString()
  await pushSnapshot(pushDeps(session), JSON.stringify(tasks), updatedAt)
  setLastSyncedAt(updatedAt)
  return updatedAt
}

export interface RestoredSnapshot {
  tasks: Task[]
  updatedAt: string
}

export async function restoreFromS3(session: SyncSession): Promise<RestoredSnapshot | null> {
  const result = await pullSnapshot(pullDeps(session))
  if (!result) return null
  setLastSyncedAt(result.updatedAt)
  return { tasks: JSON.parse(result.tasksJson) as Task[], updatedAt: result.updatedAt }
}

export interface ApplyOutcomeHandlers {
  onApplyRemoteSnapshot: (tasks: Task[], updatedAt: string) => void
}

export function applySyncOutcome(outcome: SyncOutcome, handlers: ApplyOutcomeHandlers): SyncStatus {
  if (outcome.status === 'up-to-date') return { kind: 'done', label: 'Already in sync.' }

  if (outcome.status === 'pushed') {
    const updatedAt = getUpdatedAt()
    if (updatedAt) setLastSyncedAt(updatedAt)
    return { kind: 'done', label: 'Backed up to S3.' }
  }

  if (outcome.status === 'pulled') {
    handlers.onApplyRemoteSnapshot(JSON.parse(outcome.tasksJson) as Task[], outcome.updatedAt)
    setLastSyncedAt(outcome.updatedAt)
    return { kind: 'done', label: 'Restored from S3.' }
  }

  return { kind: 'conflict', localUpdatedAt: outcome.localUpdatedAt, remoteUpdatedAt: outcome.remoteUpdatedAt }
}

export function describeSyncError(error: unknown): string {
  if (error instanceof AuthError) return 'The sync token was rejected. Check the token below.'
  if (error instanceof NetworkError) return 'Could not reach the sync server.'
  if (error instanceof ServerError) return 'The sync server returned an error.'
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
