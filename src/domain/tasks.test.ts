import { describe, expect, it } from 'vitest'
import { addTask, completeTask, filterTasks, initialTasks, type Task } from './tasks'

describe('task domain', () => {
  it('adds a task to the inbox with safe defaults', () => {
    const tasks = addTask([], '  Ship the first release  ', () => 'task-1', () => new Date('2026-08-13T08:00:00Z'))

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        title: 'Ship the first release',
        status: 'open',
        project: 'Inbox',
        priority: 'none',
      }),
    ])
  })

  it('does not add an empty task', () => {
    expect(addTask(initialTasks, '   ')).toBe(initialTasks)
  })

  it('marks a task complete without changing the other tasks', () => {
    const tasks: Task[] = [
      { id: 'a', title: 'One', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', title: 'Two', status: 'open', project: 'Work', priority: 'high', createdAt: '2026-01-01T00:00:00Z' },
    ]

    const result = completeTask(tasks, 'a', () => new Date('2026-01-02T00:00:00Z'))

    expect(result[0]).toMatchObject({ status: 'completed', completedAt: '2026-01-02T00:00:00.000Z' })
    expect(result[1]).toBe(tasks[1])
  })

  it('filters today, upcoming, and completed views', () => {
    const tasks: Task[] = [
      { id: 'today', title: 'Today', status: 'open', project: 'Inbox', priority: 'none', dueDate: '2026-08-13', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'later', title: 'Later', status: 'open', project: 'Inbox', priority: 'none', dueDate: '2026-08-14', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'done', title: 'Done', status: 'completed', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
    ]

    expect(filterTasks(tasks, 'today', '2026-08-13').map((task) => task.id)).toEqual(['today'])
    expect(filterTasks(tasks, 'upcoming', '2026-08-13').map((task) => task.id)).toEqual(['later'])
    expect(filterTasks(tasks, 'completed', '2026-08-13').map((task) => task.id)).toEqual(['done'])
  })
})
