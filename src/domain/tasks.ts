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

export function deleteTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id)
}

export function updateTask(tasks: Task[], updated: Task): Task[] {
  return tasks.map((task) => (task.id === updated.id ? updated : task))
}

export function moveTask(tasks: Task[], id: string, project: string): Task[] {
  if (!tasks.some((task) => task.id === id && task.project !== project)) return tasks
  return tasks.map((task) => (task.id === id ? { ...task, project } : task))
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
