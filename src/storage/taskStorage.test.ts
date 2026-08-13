import { beforeEach, describe, expect, it } from 'vitest'
import { loadTasks, saveTasks } from './taskStorage'
import type { Task } from '../domain/tasks'

describe('task storage', () => {
  beforeEach(() => localStorage.clear())

  it('round trips tasks through local storage', () => {
    const tasks: Task[] = [{ id: 'a', title: 'Stored task', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' }]
    saveTasks(tasks)
    expect(loadTasks([])).toEqual(tasks)
  })

  it('falls back safely when persisted data is malformed', () => {
    localStorage.setItem('nakul-todo.tasks.v1', '{not-json')
    const fallback: Task[] = [{ id: 'fallback', title: 'Fallback', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' }]
    expect(loadTasks(fallback)).toBe(fallback)
  })
})
