export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'done'; label: string }
  | { kind: 'conflict'; localUpdatedAt: string | null; remoteUpdatedAt: string | null }
  | { kind: 'error'; message: string }

export function describeSyncStatus(status: SyncStatus, configured: boolean): { label: string; className: string } {
  if (!configured) return { label: 'S3 not configured', className: 'not-configured' }
  switch (status.kind) {
    case 'working':
      return { label: status.label, className: 'syncing' }
    case 'done':
      return { label: status.label, className: 'synced' }
    case 'conflict':
      return { label: 'Sync conflict — action needed', className: 'conflict' }
    case 'error':
      return { label: status.message, className: 'error' }
    default:
      return { label: 'Local changes saved', className: 'synced' }
  }
}
