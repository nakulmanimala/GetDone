import { describe, expect, it } from 'vitest'
import {
  addImage,
  addTask,
  completeTask,
  createTask,
  deleteList,
  deleteTask,
  emptyTrash,
  filterTasks,
  initialTasks,
  moveTask,
  purgeTask,
  removeImage,
  restoreTask,
  type Task,
} from './tasks'

const openTask = (id: string, project = 'Inbox', extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: 'open',
  project,
  priority: 'none',
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
})

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

  it('creates a task with full details from the composer modal', () => {
    const tasks = createTask(
      [],
      {
        title: '  Write release notes  ',
        note: '<b>Cover</b> the sync changes',
        project: 'GetDone',
        priority: 'high',
        dueDate: '2026-08-15',
        reminderAt: '2026-08-15T09:00:00.000Z',
        repeat: 'weekly',
        flagged: true,
      },
      () => 'task-1',
      () => new Date('2026-08-14T08:00:00Z'),
    )

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        title: 'Write release notes',
        status: 'open',
        note: '<b>Cover</b> the sync changes',
        project: 'GetDone',
        priority: 'high',
        dueDate: '2026-08-15',
        reminderAt: '2026-08-15T09:00:00.000Z',
        repeat: 'weekly',
        flagged: true,
      }),
    ])
  })

  it('does not create a detailed task without a title', () => {
    expect(createTask(initialTasks, { title: '   ', priority: 'high' })).toBe(initialTasks)
  })

  it('omits the flagged field when the flag is off', () => {
    const tasks = createTask([], { title: 'Plain', flagged: false }, () => 'task-1')
    expect(tasks[0].flagged).toBeUndefined()
  })

  it('soft-deletes into the bin, restores, and purges', () => {
    const tasks = [openTask('a'), openTask('b')]

    const trashed = deleteTask(tasks, 'a', () => new Date('2026-08-14T10:00:00Z'))
    expect(trashed[0].deletedAt).toBe('2026-08-14T10:00:00.000Z')
    expect(trashed[1]).toBe(tasks[1])

    const restored = restoreTask(trashed, 'a')
    expect(restored[0].deletedAt).toBeUndefined()

    expect(purgeTask(trashed, 'a').map((task) => task.id)).toEqual(['b'])
  })

  it('emptyTrash removes only trashed tasks', () => {
    const tasks = [openTask('keep'), openTask('gone', 'Inbox', { deletedAt: '2026-08-14T10:00:00Z' })]
    expect(emptyTrash(tasks).map((task) => task.id)).toEqual(['keep'])
  })

  it('deleteList reassigns its tasks (even trashed ones) to the fallback', () => {
    const tasks = [
      openTask('a', 'Backlog'),
      openTask('b', 'Backlog', { deletedAt: '2026-08-14T10:00:00Z' }),
      openTask('c', 'Personal'),
    ]

    const result = deleteList(tasks, 'Backlog')

    expect(result[0].project).toBe('Inbox')
    expect(result[1].project).toBe('Inbox')
    expect(result[2]).toBe(tasks[2])
    expect(deleteList(tasks, 'Empty')).toBe(tasks)
  })

  it('moves a task to another list without touching other tasks', () => {
    const tasks: Task[] = [
      { id: 'a', title: 'One', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', title: 'Two', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
    ]

    const result = moveTask(tasks, 'a', 'Backlog')

    expect(result[0]).toMatchObject({ id: 'a', project: 'Backlog' })
    expect(result[1]).toBe(tasks[1])
  })

  it('moveTask is a no-op for the same list or an unknown task', () => {
    const tasks: Task[] = [
      { id: 'a', title: 'One', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
    ]

    expect(moveTask(tasks, 'a', 'Inbox')).toBe(tasks)
    expect(moveTask(tasks, 'nope', 'Backlog')).toBe(tasks)
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

  it('attaches a pasted image to the target task without touching others', () => {
    const tasks: Task[] = [
      { id: 'a', title: 'One', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', title: 'Two', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
    ]

    const result = addImage(tasks, 'a', 'data:image/jpeg;base64,xyz', () => 'img-1', () => new Date('2026-01-02T00:00:00Z'))

    expect(result[0].images).toEqual([{ id: 'img-1', dataUrl: 'data:image/jpeg;base64,xyz', addedAt: '2026-01-02T00:00:00.000Z' }])
    expect(result[1]).toBe(tasks[1])
  })

  it('appends to existing images rather than replacing them', () => {
    const tasks: Task[] = [
      {
        id: 'a',
        title: 'One',
        status: 'open',
        project: 'Inbox',
        priority: 'none',
        createdAt: '2026-01-01T00:00:00Z',
        images: [{ id: 'img-1', dataUrl: 'data:image/jpeg;base64,first', addedAt: '2026-01-01T00:00:00.000Z' }],
      },
    ]

    const result = addImage(tasks, 'a', 'data:image/jpeg;base64,second', () => 'img-2', () => new Date('2026-01-02T00:00:00Z'))

    expect(result[0].images?.map((image) => image.id)).toEqual(['img-1', 'img-2'])
  })

  it('removes an image by id and leaves other images and tasks untouched', () => {
    const tasks: Task[] = [
      {
        id: 'a',
        title: 'One',
        status: 'open',
        project: 'Inbox',
        priority: 'none',
        createdAt: '2026-01-01T00:00:00Z',
        images: [
          { id: 'img-1', dataUrl: 'data:image/jpeg;base64,first', addedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'img-2', dataUrl: 'data:image/jpeg;base64,second', addedAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
      { id: 'b', title: 'Two', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
    ]

    const result = removeImage(tasks, 'a', 'img-1')

    expect(result[0].images?.map((image) => image.id)).toEqual(['img-2'])
    expect(result[1]).toBe(tasks[1])
  })

  it('removeImage is a no-op for an unknown image id', () => {
    const tasks: Task[] = [
      {
        id: 'a',
        title: 'One',
        status: 'open',
        project: 'Inbox',
        priority: 'none',
        createdAt: '2026-01-01T00:00:00Z',
        images: [{ id: 'img-1', dataUrl: 'data:image/jpeg;base64,first', addedAt: '2026-01-01T00:00:00.000Z' }],
      },
    ]

    expect(removeImage(tasks, 'a', 'nope').map((task) => task.images)).toEqual(tasks.map((task) => task.images))
  })
})
