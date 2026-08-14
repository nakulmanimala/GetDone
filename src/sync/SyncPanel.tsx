import { useState, type FormEvent } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { Task } from '../domain/tasks'
import { createApiClient } from './apiClient'
import { deriveKey, generateSaltBase64 } from './crypto'
import {
  applySyncOutcome,
  backupNow,
  checkSync,
  describeSyncError,
  restoreFromS3,
  type SyncSession,
} from './syncActions'
import {
  getApiToken,
  getLastSyncedAt,
  getSalt,
  isConfigured,
  setApiToken,
  setConfigured,
  setSalt,
} from './syncMeta'
import type { SyncStatus } from './syncStatus'

const KDF_ITERATIONS = 250_000

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

interface SyncPanelProps {
  tasks: Task[]
  status: SyncStatus
  onStatusChange: (status: SyncStatus) => void
  onApplyRemoteSnapshot: (tasks: Task[], updatedAt: string) => void
  cryptoKey: CryptoKey | null
  onUnlock: (key: CryptoKey) => void
  onClose: () => void
}

export function SyncPanel({ tasks, status, onStatusChange, onApplyRemoteSnapshot, cryptoKey, onUnlock, onClose }: SyncPanelProps) {
  const [configured, setConfiguredState] = useState(isConfigured())
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [apiTokenInput, setApiTokenInput] = useState(getApiToken() ?? '')

  const lastSyncedAt = getLastSyncedAt()
  const working = status.kind === 'working'

  function session(key: CryptoKey): SyncSession {
    return { cryptoKey: key, api: createApiClient() }
  }

  async function handleSetup(event: FormEvent) {
    event.preventDefault()
    if (!passphrase || passphrase !== confirmPassphrase) {
      onStatusChange({ kind: 'error', message: 'Passphrases must match.' })
      return
    }
    if (!apiTokenInput.trim()) {
      onStatusChange({ kind: 'error', message: 'An API token is required.' })
      return
    }

    const salt = generateSaltBase64()
    setSalt(salt)
    setApiToken(apiTokenInput.trim())
    setConfigured(true)
    setConfiguredState(true)

    onUnlock(await deriveKey(passphrase, salt, KDF_ITERATIONS))
    setPassphrase('')
    setConfirmPassphrase('')
    onStatusChange({ kind: 'idle' })
  }

  async function handleUnlock(event: FormEvent) {
    event.preventDefault()
    const salt = getSalt()
    if (!salt) return
    onUnlock(await deriveKey(passphrase, salt, KDF_ITERATIONS))
    setPassphrase('')
  }

  async function handleCheck() {
    if (!cryptoKey) return
    onStatusChange({ kind: 'working', label: 'Checking…' })
    try {
      const outcome = await checkSync(session(cryptoKey), tasks)
      onStatusChange(applySyncOutcome(outcome, { onApplyRemoteSnapshot }))
    } catch (error) {
      onStatusChange({ kind: 'error', message: describeSyncError(error) })
    }
  }

  async function handleBackupNow() {
    if (!cryptoKey) return
    onStatusChange({ kind: 'working', label: 'Backing up…' })
    try {
      await backupNow(session(cryptoKey), tasks)
      onStatusChange({ kind: 'done', label: 'Backed up to S3.' })
    } catch (error) {
      onStatusChange({ kind: 'error', message: describeSyncError(error) })
    }
  }

  async function handleRestore() {
    if (!cryptoKey) return
    if (!window.confirm('Restore will replace all local tasks with the S3 backup. Continue?')) return
    onStatusChange({ kind: 'working', label: 'Restoring…' })
    try {
      const result = await restoreFromS3(session(cryptoKey))
      if (!result) {
        onStatusChange({ kind: 'error', message: 'No backup found in S3 yet.' })
        return
      }
      onApplyRemoteSnapshot(result.tasks, result.updatedAt)
      onStatusChange({ kind: 'done', label: 'Restored from S3.' })
    } catch (error) {
      onStatusChange({ kind: 'error', message: describeSyncError(error) })
    }
  }

  async function resolveConflict(keep: 'local' | 's3') {
    if (!cryptoKey) return
    onStatusChange({ kind: 'working', label: 'Resolving…' })
    try {
      if (keep === 'local') {
        await backupNow(session(cryptoKey), tasks)
        onStatusChange({ kind: 'done', label: 'Kept local — backed up to S3.' })
      } else {
        const result = await restoreFromS3(session(cryptoKey))
        if (result) onApplyRemoteSnapshot(result.tasks, result.updatedAt)
        onStatusChange({ kind: 'done', label: 'Kept S3 — restored locally.' })
      }
    } catch (error) {
      onStatusChange({ kind: 'error', message: describeSyncError(error) })
    }
  }

  return (
    <aside className="detail-panel sync-panel">
      <div className="detail-header">
        <span>S3 Backup</span>
        <button className="icon-button" onClick={onClose} aria-label="Close sync panel"><X size={18} /></button>
      </div>
      <div className="detail-body">
        {!configured && (
          <form className="sync-form" onSubmit={handleSetup}>
            <div className="warning-banner">
              <AlertTriangle size={14} />
              <span>There is no password recovery. If you forget this passphrase, this backup can never be decrypted again.</span>
            </div>
            <label>Passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required /></label>
            <label>Confirm<input type="password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} required /></label>
            <label>API token<input type="password" value={apiTokenInput} onChange={(event) => setApiTokenInput(event.target.value)} placeholder="SYNC_API_TOKEN" required /></label>
            <p className="sync-hint">This token is separate from your AWS credentials — it only authenticates this browser to your self-hosted sync server.</p>
            <button type="submit" className="sync-primary-button">Set up S3 Backup</button>
          </form>
        )}

        {configured && !cryptoKey && (
          <form className="sync-form" onSubmit={handleUnlock}>
            <p className="sync-hint">Enter your passphrase to unlock S3 backup for this session. Once unlocked, changes back up automatically.</p>
            <label>Passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required autoFocus /></label>
            <button type="submit" className="sync-primary-button">Unlock</button>
          </form>
        )}

        {configured && cryptoKey && (
          <div className="sync-actions">
            <p className="sync-hint">Auto backup is on — changes sync a few seconds after you make them.</p>
            <p className="sync-hint">Last synced: {lastSyncedAt ? formatTimestamp(lastSyncedAt) : 'Never'}</p>

            {status.kind === 'conflict' && (
              <div className="conflict-banner">
                <AlertTriangle size={14} />
                <p>Local and S3 both changed since the last sync. Choose which to keep.</p>
                <div className="conflict-actions">
                  <button onClick={() => resolveConflict('local')} disabled={working}>Keep local</button>
                  <button onClick={() => resolveConflict('s3')} disabled={working}>Keep S3</button>
                </div>
              </div>
            )}

            {status.kind === 'error' && <p className="sync-error">{status.message}</p>}
            {(status.kind === 'done' || status.kind === 'working') && <p className="sync-hint">{status.label}</p>}

            <button className="sync-primary-button" onClick={handleCheck} disabled={working}>Check for updates</button>
            <button onClick={handleBackupNow} disabled={working}>Back Up Now</button>
            <button onClick={handleRestore} disabled={working}>Restore from S3</button>
          </div>
        )}
      </div>
    </aside>
  )
}
