import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimPreAccountTasks, loadProjects, loadTasks, saveProjects, saveTasks, scopedKey } from './taskStorage'
import type { Task } from '../domain/tasks'

const ALICE = '1001'
const BOB = '1002'

const task = (id: string, title = id): Task => ({
  id, title, status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z',
})

describe('task storage', () => {
  beforeEach(() => localStorage.clear())

  it('round trips tasks for a user', () => {
    saveTasks(ALICE, [task('a', 'Stored task')])
    expect(loadTasks(ALICE, [])).toEqual([task('a', 'Stored task')])
  })

  // The privacy requirement, at the storage layer: teammates sharing a browser
  // profile must not be able to see each other's lists.
  it('keeps each user\'s tasks separate', () => {
    saveTasks(ALICE, [task('alice-task', 'Alice private')])
    saveTasks(BOB, [task('bob-task', 'Bob private')])

    expect(loadTasks(ALICE, []).map((t) => t.title)).toEqual(['Alice private'])
    expect(loadTasks(BOB, []).map((t) => t.title)).toEqual(['Bob private'])
  })

  it('shows a new user an empty list, not the previous user\'s', () => {
    saveTasks(ALICE, [task('alice-task', 'Alice private')])
    expect(loadTasks(BOB, [])).toEqual([])
  })

  it('writes under a per-user key', () => {
    saveTasks(ALICE, [task('a')])
    expect(localStorage.getItem(scopedKey('getdone.tasks.v1', ALICE))).not.toBeNull()
    expect(localStorage.getItem('getdone.tasks.v1')).toBeNull()
  })

  it('falls back safely when persisted data is malformed', () => {
    localStorage.setItem(scopedKey('getdone.tasks.v1', ALICE), '{not-json')
    const fallback = [task('fallback')]
    expect(loadTasks(ALICE, fallback)).toBe(fallback)
  })

  it('returns false instead of throwing when storage is full', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    expect(saveTasks(ALICE, [task('a')])).toBe(false)

    setItemSpy.mockRestore()
  })

  it('returns true on a successful save', () => {
    expect(saveTasks(ALICE, [task('a')])).toBe(true)
  })

  it('round trips project lists per user', () => {
    saveProjects(ALICE, ['Inbox', 'Errands'])
    expect(loadProjects(ALICE, ['Inbox'])).toEqual(['Inbox', 'Errands'])
    expect(loadProjects(BOB, ['Inbox'])).toEqual(['Inbox'])
  })

  it('falls back for missing, malformed, or empty project lists', () => {
    const key = scopedKey('getdone.projects.v1', ALICE)
    expect(loadProjects(ALICE, ['Inbox'])).toEqual(['Inbox'])

    localStorage.setItem(key, '{not-json')
    expect(loadProjects(ALICE, ['Inbox'])).toEqual(['Inbox'])

    localStorage.setItem(key, '[]')
    expect(loadProjects(ALICE, ['Inbox'])).toEqual(['Inbox'])

    localStorage.setItem(key, '[1,2]')
    expect(loadProjects(ALICE, ['Inbox'])).toEqual(['Inbox'])
  })
})

describe('claimPreAccountTasks', () => {
  beforeEach(() => localStorage.clear())

  it('hands the pre-accounts list to the first user who signs in', () => {
    localStorage.setItem('getdone.tasks.v1', JSON.stringify([task('old', 'From before accounts')]))
    localStorage.setItem('getdone.projects.v1', JSON.stringify(['Inbox', 'Legacy']))

    claimPreAccountTasks(ALICE)

    expect(loadTasks(ALICE, []).map((t) => t.title)).toEqual(['From before accounts'])
    expect(loadProjects(ALICE, [])).toEqual(['Inbox', 'Legacy'])
  })

  it('also picks up the oldest storage key', () => {
    localStorage.setItem('nakul-todo.tasks.v1', JSON.stringify([task('ancient', 'Ancient')]))

    claimPreAccountTasks(ALICE)

    expect(loadTasks(ALICE, []).map((t) => t.title)).toEqual(['Ancient'])
    expect(localStorage.getItem('nakul-todo.tasks.v1')).toBeNull()
  })

  // Otherwise every teammate signing in on this machine would inherit a copy
  // of the first person's tasks.
  it('does not hand the same list to a second user', () => {
    localStorage.setItem('getdone.tasks.v1', JSON.stringify([task('old', 'From before accounts')]))

    claimPreAccountTasks(ALICE)
    claimPreAccountTasks(BOB)

    expect(loadTasks(BOB, [])).toEqual([])
  })

  it('never overwrites tasks the user already has', () => {
    saveTasks(ALICE, [task('mine', 'Already mine')])
    localStorage.setItem('getdone.tasks.v1', JSON.stringify([task('old', 'Stale')]))

    claimPreAccountTasks(ALICE)

    expect(loadTasks(ALICE, []).map((t) => t.title)).toEqual(['Already mine'])
  })

  it('is a no-op when there is nothing to adopt', () => {
    claimPreAccountTasks(ALICE)
    expect(loadTasks(ALICE, [])).toEqual([])
  })

  // The shared bearer token is dead once Google sign-in replaces it; leaving
  // it in every teammate's browser is a stale secret for no benefit.
  it('scrubs the pre-accounts sync token and watermarks', () => {
    localStorage.setItem('getdone.sync.apiToken.v1', 'old-shared-token')
    localStorage.setItem('getdone.sync.configured.v1', 'true')
    localStorage.setItem('getdone.sync.lastSyncedAt.v1', '2026-08-14T00:00:00.000Z')
    localStorage.setItem('getdone.sync.updatedAt.v1', '2026-08-14T00:00:00.000Z')

    claimPreAccountTasks(ALICE)

    expect(localStorage.getItem('getdone.sync.apiToken.v1')).toBeNull()
    expect(localStorage.getItem('getdone.sync.configured.v1')).toBeNull()
    expect(localStorage.getItem('getdone.sync.lastSyncedAt.v1')).toBeNull()
    expect(localStorage.getItem('getdone.sync.updatedAt.v1')).toBeNull()
  })

  it('scrubs the old token even when there are no tasks to adopt', () => {
    localStorage.setItem('getdone.sync.apiToken.v1', 'old-shared-token')

    claimPreAccountTasks(ALICE)

    expect(localStorage.getItem('getdone.sync.apiToken.v1')).toBeNull()
  })
})
