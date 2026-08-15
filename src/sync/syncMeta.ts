// Sync watermarks are per-user for the same reason task data is: two
// teammates on one browser must not share a "last synced" clock, or one of
// them would push against the other's watermark and trip false conflicts.
const BASE_KEYS = {
  updatedAt: 'getdone.sync.updatedAt.v1',
  lastSyncedAt: 'getdone.sync.lastSyncedAt.v1',
} as const

let currentUserId: string | null = null

/** Called once the session is known, before any sync work runs. */
export function setSyncScope(userId: string | null): void {
  currentUserId = userId
}

function key(base: string): string {
  return currentUserId ? `${base}::${currentUserId}` : base
}

function read(base: string): string | null {
  return currentUserId ? localStorage.getItem(key(base)) : null
}

function write(base: string, value: string): void {
  if (currentUserId) localStorage.setItem(key(base), value)
}

export function getUpdatedAt(): string | null {
  return read(BASE_KEYS.updatedAt)
}

export function setUpdatedAt(value: string): void {
  write(BASE_KEYS.updatedAt, value)
}

export function touchUpdatedAt(now: () => Date = () => new Date()): void {
  setUpdatedAt(now().toISOString())
}

export function getLastSyncedAt(): string | null {
  return read(BASE_KEYS.lastSyncedAt)
}

export function setLastSyncedAt(value: string): void {
  write(BASE_KEYS.lastSyncedAt, value)
}

/**
 * Backup is available to every signed-in user now — the server holds the AWS
 * credentials and derives the object key from the session, so there is no
 * per-browser token to configure any more.
 */
export function isConfigured(): boolean {
  return currentUserId !== null
}

/** Drops this user's watermarks, e.g. on sign-out. */
export function clearSyncScope(userId: string): void {
  for (const base of Object.values(BASE_KEYS)) {
    localStorage.removeItem(`${base}::${userId}`)
  }
}
