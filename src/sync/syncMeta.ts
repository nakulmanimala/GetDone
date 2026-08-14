const KEYS = {
  updatedAt: 'getdone.sync.updatedAt.v1',
  lastSyncedAt: 'getdone.sync.lastSyncedAt.v1',
  salt: 'getdone.sync.salt.v1',
  apiToken: 'getdone.sync.apiToken.v1',
  configured: 'getdone.sync.configured.v1',
} as const

export function getUpdatedAt(): string | null {
  return localStorage.getItem(KEYS.updatedAt)
}

export function setUpdatedAt(value: string): void {
  localStorage.setItem(KEYS.updatedAt, value)
}

export function touchUpdatedAt(now: () => Date = () => new Date()): void {
  setUpdatedAt(now().toISOString())
}

export function getLastSyncedAt(): string | null {
  return localStorage.getItem(KEYS.lastSyncedAt)
}

export function setLastSyncedAt(value: string): void {
  localStorage.setItem(KEYS.lastSyncedAt, value)
}

export function getSalt(): string | null {
  return localStorage.getItem(KEYS.salt)
}

export function setSalt(value: string): void {
  localStorage.setItem(KEYS.salt, value)
}

export function getApiToken(): string | null {
  return localStorage.getItem(KEYS.apiToken)
}

export function setApiToken(value: string): void {
  localStorage.setItem(KEYS.apiToken, value)
}

export function isConfigured(): boolean {
  return localStorage.getItem(KEYS.configured) === 'true'
}

export function setConfigured(value: boolean): void {
  localStorage.setItem(KEYS.configured, value ? 'true' : 'false')
}
