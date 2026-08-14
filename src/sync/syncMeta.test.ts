import { beforeEach, describe, expect, it } from 'vitest'
import {
  getApiToken,
  getLastSyncedAt,
  getSalt,
  getUpdatedAt,
  isConfigured,
  setApiToken,
  setConfigured,
  setLastSyncedAt,
  setSalt,
  setUpdatedAt,
  touchUpdatedAt,
} from './syncMeta'

describe('syncMeta', () => {
  beforeEach(() => localStorage.clear())

  it('round trips updatedAt', () => {
    expect(getUpdatedAt()).toBeNull()
    setUpdatedAt('2026-08-14T00:00:00.000Z')
    expect(getUpdatedAt()).toBe('2026-08-14T00:00:00.000Z')
  })

  it('touchUpdatedAt stamps the injected current time', () => {
    touchUpdatedAt(() => new Date('2026-08-14T12:00:00.000Z'))
    expect(getUpdatedAt()).toBe('2026-08-14T12:00:00.000Z')
  })

  it('round trips lastSyncedAt', () => {
    expect(getLastSyncedAt()).toBeNull()
    setLastSyncedAt('2026-08-14T00:00:00.000Z')
    expect(getLastSyncedAt()).toBe('2026-08-14T00:00:00.000Z')
  })

  it('round trips the salt', () => {
    expect(getSalt()).toBeNull()
    setSalt('c2FsdA==')
    expect(getSalt()).toBe('c2FsdA==')
  })

  it('round trips the api token', () => {
    expect(getApiToken()).toBeNull()
    setApiToken('secret-token')
    expect(getApiToken()).toBe('secret-token')
  })

  it('defaults isConfigured to false and round trips true/false', () => {
    expect(isConfigured()).toBe(false)
    setConfigured(true)
    expect(isConfigured()).toBe(true)
    setConfigured(false)
    expect(isConfigured()).toBe(false)
  })
})
