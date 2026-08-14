import type { SnapshotEnvelope, SnapshotMeta } from './apiClient'

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

export interface EncryptedPushDeps {
  putSnapshot: (envelope: SnapshotEnvelope) => Promise<void>
  encrypt: (plaintext: string) => Promise<{ ciphertext: string; iv: string }>
  saltBase64: string
  kdfIterations: number
}

export async function pushSnapshot(deps: EncryptedPushDeps, tasksJson: string, updatedAt: string): Promise<void> {
  const { ciphertext, iv } = await deps.encrypt(tasksJson)
  await deps.putSnapshot({
    schemaVersion: 1,
    kdfName: 'PBKDF2-SHA256',
    kdfIterations: deps.kdfIterations,
    salt: deps.saltBase64,
    iv,
    updatedAt,
    ciphertext,
  })
}

export interface EncryptedPullDeps {
  fetchSnapshot: () => Promise<SnapshotEnvelope | null>
  decrypt: (ciphertext: string, iv: string) => Promise<string>
}

export interface PulledSnapshot {
  tasksJson: string
  updatedAt: string
}

export async function pullSnapshot(deps: EncryptedPullDeps): Promise<PulledSnapshot | null> {
  const envelope = await deps.fetchSnapshot()
  if (!envelope) return null
  const tasksJson = await deps.decrypt(envelope.ciphertext, envelope.iv)
  return { tasksJson, updatedAt: envelope.updatedAt }
}

export type SyncOutcome =
  | { status: 'up-to-date' }
  | { status: 'pushed' }
  | { status: 'pulled'; tasksJson: string; updatedAt: string }
  | { status: 'conflict'; localUpdatedAt: string | null; remoteUpdatedAt: string | null }

export interface RunSyncDeps extends EncryptedPushDeps, EncryptedPullDeps {
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
