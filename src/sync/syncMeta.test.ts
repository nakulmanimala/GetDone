import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSyncScope,
  getLastSyncedAt,
  getUpdatedAt,
  isConfigured,
  setLastSyncedAt,
  setSyncScope,
  setUpdatedAt,
  touchUpdatedAt,
} from './syncMeta'

describe('syncMeta', () => {
  beforeEach(() => {
    localStorage.clear()
    setSyncScope('1001')
  })

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

  // Sharing a watermark between accounts would make one user's push look like
  // a remote change to the other, producing phantom conflicts.
  it('keeps each user\'s watermarks separate', () => {
    setLastSyncedAt('2026-08-14T00:00:00.000Z')

    setSyncScope('1002')
    expect(getLastSyncedAt()).toBeNull()
    setLastSyncedAt('2026-08-15T00:00:00.000Z')

    setSyncScope('1001')
    expect(getLastSyncedAt()).toBe('2026-08-14T00:00:00.000Z')
  })

  it('reads and writes nothing while signed out', () => {
    setSyncScope(null)
    setUpdatedAt('2026-08-14T00:00:00.000Z')

    expect(getUpdatedAt()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('treats being signed in as being configured', () => {
    expect(isConfigured()).toBe(true)
    setSyncScope(null)
    expect(isConfigured()).toBe(false)
  })

  it('clears one user\'s watermarks without touching another\'s', () => {
    setLastSyncedAt('2026-08-14T00:00:00.000Z')
    setSyncScope('1002')
    setLastSyncedAt('2026-08-15T00:00:00.000Z')

    clearSyncScope('1001')

    expect(getLastSyncedAt()).toBe('2026-08-15T00:00:00.000Z')
    setSyncScope('1001')
    expect(getLastSyncedAt()).toBeNull()
  })
})
