import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadProjects, loadTasks, saveProjects, saveTasks } from './taskStorage'
import type { Task } from '../domain/tasks'

describe('task storage', () => {
  beforeEach(() => localStorage.clear())

  it('round trips tasks through local storage', () => {
    const tasks: Task[] = [{ id: 'a', title: 'Stored task', status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z' }]
    saveTasks(tasks)
    expect(loadTasks([])).toEqual(tasks)
  })

  it('migrates tasks from the legacy storage key', () => {
    const tasks: Task[] = [{ id: 'legacy', title: 'Keep this task', status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z' }]
    localStorage.setItem('nakul-todo.tasks.v1', JSON.stringify(tasks))

    expect(loadTasks([])).toEqual(tasks)
    expect(localStorage.getItem('getdone.tasks.v1')).toBe(JSON.stringify(tasks))
    expect(localStorage.getItem('nakul-todo.tasks.v1')).toBeNull()
  })

  it('falls back safely when persisted data is malformed', () => {
    localStorage.setItem('getdone.tasks.v1', '{not-json')
    const fallback: Task[] = [{ id: 'fallback', title: 'Fallback', status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z' }]
    expect(loadTasks(fallback)).toBe(fallback)
  })

  it('returns false instead of throwing when storage is full', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    const tasks: Task[] = [{ id: 'a', title: 'Task', status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z' }]
    expect(saveTasks(tasks)).toBe(false)

    setItemSpy.mockRestore()
  })

  it('returns true on a successful save', () => {
    const tasks: Task[] = [{ id: 'a', title: 'Task', status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z' }]
    expect(saveTasks(tasks)).toBe(true)
  })

  it('round trips project lists through local storage', () => {
    saveProjects(['Inbox', 'Errands'])
    expect(loadProjects(['Inbox'])).toEqual(['Inbox', 'Errands'])
  })

  it('falls back for missing, malformed, or empty project lists', () => {
    expect(loadProjects(['Inbox'])).toEqual(['Inbox'])

    localStorage.setItem('getdone.projects.v1', '{not-json')
    expect(loadProjects(['Inbox'])).toEqual(['Inbox'])

    localStorage.setItem('getdone.projects.v1', '[]')
    expect(loadProjects(['Inbox'])).toEqual(['Inbox'])

    localStorage.setItem('getdone.projects.v1', '[1,2]')
    expect(loadProjects(['Inbox'])).toEqual(['Inbox'])
  })
})
