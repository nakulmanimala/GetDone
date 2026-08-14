export type TaskStatus = 'open' | 'completed'
export type Priority = 'none' | 'low' | 'medium' | 'high'
export type View = 'inbox' | 'today' | 'upcoming' | 'completed'
export type Repeat = 'daily' | 'weekly' | 'monthly'

export interface TaskImage {
  id: string
  dataUrl: string
  addedAt: string
}

export interface Task {
  id: string
  title: string
  status: TaskStatus
  project: string
  priority: Priority
  dueDate?: string
  note?: string
  reminderAt?: string
  repeat?: Repeat
  flagged?: boolean
  createdAt: string
  completedAt?: string
  deletedAt?: string
  images?: TaskImage[]
}

export interface TaskDraft {
  title: string
  note?: string
  project?: string
  priority?: Priority
  dueDate?: string
  reminderAt?: string
  repeat?: Repeat
  flagged?: boolean
}

export const initialTasks: Task[] = [
  {
    id: 'welcome-1',
    title: 'Plan the week ahead',
    status: 'open',
    project: 'Personal',
    priority: 'high',
    dueDate: new Date().toISOString().slice(0, 10),
    note: 'Choose the three outcomes that would make this week successful.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'welcome-2',
    title: 'Review infrastructure changes',
    status: 'open',
    project: 'DevOps',
    priority: 'medium',
    dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    note: 'Check the pending Terraform plan before deployment.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'welcome-3',
    title: 'Set up S3 backup profile',
    status: 'open',
    project: 'GetDone',
    priority: 'low',
    note: 'S3 backup and multi-device sync arrive in a later milestone.',
    createdAt: new Date().toISOString(),
  },
]

const defaultId = () => crypto.randomUUID()
const defaultNow = () => new Date()

export function addTask(
  tasks: Task[],
  rawTitle: string,
  createId: () => string = defaultId,
  now: () => Date = defaultNow,
): Task[] {
  return createTask(tasks, { title: rawTitle }, createId, now)
}

export function createTask(
  tasks: Task[],
  draft: TaskDraft,
  createId: () => string = defaultId,
  now: () => Date = defaultNow,
): Task[] {
  const title = draft.title.trim()
  if (!title) return tasks

  return [
    {
      id: createId(),
      title,
      status: 'open',
      project: draft.project ?? 'Inbox',
      priority: draft.priority ?? 'none',
      dueDate: draft.dueDate,
      note: draft.note,
      reminderAt: draft.reminderAt,
      repeat: draft.repeat,
      flagged: draft.flagged || undefined,
      createdAt: now().toISOString(),
    },
    ...tasks,
  ]
}

export function completeTask(tasks: Task[], id: string, now: () => Date = defaultNow): Task[] {
  return tasks.map((task) =>
    task.id === id
      ? { ...task, status: 'completed', completedAt: now().toISOString() }
      : task,
  )
}

export function reopenTask(tasks: Task[], id: string): Task[] {
  return tasks.map((task) =>
    task.id === id ? { ...task, status: 'open', completedAt: undefined } : task,
  )
}

// Deleting is soft: the task moves to the recycle bin, where it can be
// restored (restoreTask) or removed for good (purgeTask / emptyTrash).
export function deleteTask(tasks: Task[], id: string, now: () => Date = defaultNow): Task[] {
  return tasks.map((task) => (task.id === id ? { ...task, deletedAt: now().toISOString() } : task))
}

export function restoreTask(tasks: Task[], id: string): Task[] {
  return tasks.map((task) => (task.id === id ? { ...task, deletedAt: undefined } : task))
}

export function purgeTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id)
}

export function emptyTrash(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.deletedAt)
}

// Removing a list keeps its tasks: they are reassigned to the fallback list
// (Inbox), including any that are sitting in the recycle bin.
export function deleteList(tasks: Task[], project: string, fallback = 'Inbox'): Task[] {
  if (!tasks.some((task) => task.project === project)) return tasks
  return tasks.map((task) => (task.project === project ? { ...task, project: fallback } : task))
}

export function updateTask(tasks: Task[], updated: Task): Task[] {
  return tasks.map((task) => (task.id === updated.id ? updated : task))
}

export function moveTask(tasks: Task[], id: string, project: string): Task[] {
  if (!tasks.some((task) => task.id === id && task.project !== project)) return tasks
  return tasks.map((task) => (task.id === id ? { ...task, project } : task))
}

// Drop a task next to another one: it takes the position before/after the
// target in the array (which is the board's display order) and joins the
// target's list when dragged across columns.
export function reorderTask(tasks: Task[], id: string, targetId: string, edge: 'before' | 'after'): Task[] {
  if (id === targetId) return tasks
  const moving = tasks.find((task) => task.id === id)
  const target = tasks.find((task) => task.id === targetId)
  if (!moving || !target) return tasks

  const without = tasks.filter((task) => task.id !== id)
  const insertAt = without.findIndex((task) => task.id === targetId) + (edge === 'after' ? 1 : 0)
  const moved = moving.project === target.project ? moving : { ...moving, project: target.project }
  return [...without.slice(0, insertAt), moved, ...without.slice(insertAt)]
}

export function addImage(
  tasks: Task[],
  taskId: string,
  dataUrl: string,
  createId: () => string = defaultId,
  now: () => Date = defaultNow,
): Task[] {
  return tasks.map((task) =>
    task.id === taskId
      ? { ...task, images: [...(task.images ?? []), { id: createId(), dataUrl, addedAt: now().toISOString() }] }
      : task,
  )
}

export function removeImage(tasks: Task[], taskId: string, imageId: string): Task[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, images: (task.images ?? []).filter((image) => image.id !== imageId) } : task,
  )
}

export function filterTasks(tasks: Task[], view: View, today = new Date().toISOString().slice(0, 10)): Task[] {
  if (view === 'completed') return tasks.filter((task) => task.status === 'completed')

  const open = tasks.filter((task) => task.status === 'open')
  if (view === 'today') return open.filter((task) => task.dueDate === today)
  if (view === 'upcoming') return open.filter((task) => task.dueDate && task.dueDate > today)
  return open
}
