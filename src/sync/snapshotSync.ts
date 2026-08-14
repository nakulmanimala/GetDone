import type { SnapshotMeta, SnapshotPayload } from './apiClient'

export type SyncDecision = 'up-to-date' | 'pull' | 'push' | 'conflict'

export interface LocalSyncState {
  updatedAt: string | null
  lastSyncedAt: string | null
}

/**
 * Watermark comparison: only auto-sync a direction if nothing changed on the
 * *other* side since the last successful sync. If both sides changed, that's
 * a genuine conflict and must not be auto-resolved (see plan doc).
 */
export function decideSyncAction(local: LocalSyncState, remote: SnapshotMeta): SyncDecision {
  if (!remote.exists) return 'push'

  const localChanged = isNewer(local.updatedAt, local.lastSyncedAt)
  const remoteChanged = isNewer(remote.updatedAt, local.lastSyncedAt)

  if (localChanged && remoteChanged) return 'conflict'
  if (remoteChanged) return 'pull'
  if (localChanged) return 'push'
  return 'up-to-date'
}

function isNewer(candidate: string | null, baseline: string | null): boolean {
  if (!candidate) return false
  if (!baseline) return true
  return new Date(candidate).getTime() > new Date(baseline).getTime()
}

export interface PushDeps {
  putSnapshot: (payload: SnapshotPayload) => Promise<void>
}

export async function pushSnapshot(deps: PushDeps, tasksJson: string, updatedAt: string): Promise<void> {
  await deps.putSnapshot({ updatedAt, tasks: JSON.parse(tasksJson) })
}

export interface PullDeps {
  fetchSnapshot: () => Promise<SnapshotPayload | null>
}

export interface PulledSnapshot {
  tasksJson: string
  updatedAt: string
}

export async function pullSnapshot(deps: PullDeps): Promise<PulledSnapshot | null> {
  const payload = await deps.fetchSnapshot()
  if (!payload) return null
  return { tasksJson: JSON.stringify(payload.tasks), updatedAt: payload.updatedAt }
}

export type SyncOutcome =
  | { status: 'up-to-date' }
  | { status: 'pushed' }
  | { status: 'pulled'; tasksJson: string; updatedAt: string }
  | { status: 'conflict'; localUpdatedAt: string | null; remoteUpdatedAt: string | null }

export interface RunSyncDeps extends PushDeps, PullDeps {
  fetchMeta: () => Promise<SnapshotMeta>
  local: LocalSyncState
  tasksJson: string
  now?: () => Date
}

export async function runSync(deps: RunSyncDeps): Promise<SyncOutcome> {
  const remote = await deps.fetchMeta()
  const decision = decideSyncAction(deps.local, remote)

  if (decision === 'up-to-date') return { status: 'up-to-date' }

  if (decision === 'push') {
    const now = deps.now ?? (() => new Date())
    const updatedAt = deps.local.updatedAt ?? now().toISOString()
    await pushSnapshot(deps, deps.tasksJson, updatedAt)
    return { status: 'pushed' }
  }

  if (decision === 'pull') {
    const result = await pullSnapshot(deps)
    if (!result) return { status: 'up-to-date' }
    return { status: 'pulled', tasksJson: result.tasksJson, updatedAt: result.updatedAt }
  }

  return { status: 'conflict', localUpdatedAt: deps.local.updatedAt, remoteUpdatedAt: remote.updatedAt }
}
