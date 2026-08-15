import { useState, type FormEvent } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { ConfirmRequest } from '../components/ConfirmDialog'
import type { Task } from '../domain/tasks'
import { createApiClient } from './apiClient'
import {
  applySyncOutcome,
  backupNow,
  checkSync,
  describeSyncError,
  restoreFromS3,
  type SyncSession,
} from './syncActions'
import { getApiToken, getLastSyncedAt, isConfigured, setApiToken, setConfigured } from './syncMeta'
import type { SyncStatus } from './syncStatus'

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

interface SyncPanelProps {
  tasks: Task[]
  status: SyncStatus
  onStatusChange: (status: SyncStatus) => void
  onApplyRemoteSnapshot: (tasks: Task[], updatedAt: string) => void
  onConfigured: () => void
  onClose: () => void
  /** Raises the app's themed confirm dialog; App owns the single instance. */
  requestConfirm: (request: ConfirmRequest) => void
}

export function SyncPanel({ tasks, status, onStatusChange, onApplyRemoteSnapshot, onConfigured, onClose, requestConfirm }: SyncPanelProps) {
  const [configured, setConfiguredState] = useState(isConfigured())
  const [apiTokenInput, setApiTokenInput] = useState(getApiToken() ?? '')

  const lastSyncedAt = getLastSyncedAt()
  const working = status.kind === 'working'

  function session(): SyncSession {
    return { api: createApiClient() }
  }

  function handleSetup(event: FormEvent) {
    event.preventDefault()
    if (!apiTokenInput.trim()) {
      onStatusChange({ kind: 'error', message: 'An API token is required.' })
      return
    }

    setApiToken(apiTokenInput.trim())
    setConfigured(true)
    setConfiguredState(true)
    onConfigured()
    onStatusChange({ kind: 'idle' })
  }

  async function handleCheck() {
    onStatusChange({ kind: 'working', label: 'Checking…' })
    try {
      const outcome = await checkSync(session(), tasks)
      onStatusChange(applySyncOutcome(outcome, { onApplyRemoteSnapshot }))
    } catch (error) {
      onStatusChange({ kind: 'error', message: describeSyncError(error) })
    }
  }

  async function handleBackupNow() {
    onStatusChange({ kind: 'working', label: 'Backing up…' })
    try {
      await backupNow(session(), tasks)
      onStatusChange({ kind: 'done', label: 'Backed up to S3.' })
    } catch (error) {
      onStatusChange({ kind: 'error', message: describeSyncError(error) })
    }
  }

  function handleRestore() {
    requestConfirm({
      title: 'Restore from S3?',
      message: 'Every task on this device will be replaced by the S3 backup. This cannot be undone.',
      confirmLabel: 'Restore',
      danger: true,
      action: () => void runRestore(),
    })
  }

  async function runRestore() {
    onStatusChange({ kind: 'working', label: 'Restoring…' })
    try {
      const result = await restoreFromS3(session())
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
    onStatusChange({ kind: 'working', label: 'Resolving…' })
    try {
      if (keep === 'local') {
        await backupNow(session(), tasks)
        onStatusChange({ kind: 'done', label: 'Kept local — backed up to S3.' })
      } else {
        const result = await restoreFromS3(session())
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
          // noValidate: the browser's own "Please fill out this field" bubble
          // is unthemed and would preempt handleSetup, so the empty-token case
          // is reported through the panel's own error line instead.
          <form className="sync-form" onSubmit={handleSetup} noValidate>
            <label>API token<input type="password" value={apiTokenInput} onChange={(event) => setApiTokenInput(event.target.value)} placeholder="SYNC_API_TOKEN" required autoFocus /></label>
            {status.kind === 'error' && <p className="sync-error">{status.message}</p>}
            <p className="sync-hint">This token is separate from your AWS credentials — it only authenticates this browser to your self-hosted sync server. The server encrypts backups at rest; there's no passphrase to set here.</p>
            <button type="submit" className="sync-primary-button">Set up S3 Backup</button>
          </form>
        )}

        {configured && (
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
