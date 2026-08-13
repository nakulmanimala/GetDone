export type TaskStatus = 'open' | 'completed'
export type Priority = 'none' | 'low' | 'medium' | 'high'
export type View = 'inbox' | 'today' | 'upcoming' | 'completed'

export interface Task {
  id: string
  title: string
  status: TaskStatus
  project: string
  priority: Priority
  dueDate?: string
  note?: string
  createdAt: string
  completedAt?: string
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
  const title = rawTitle.trim()
  if (!title) return tasks

  return [
    {
      id: createId(),
      title,
      status: 'open',
      project: 'Inbox',
      priority: 'none',
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

export function filterTasks(tasks: Task[], view: View, today = new Date().toISOString().slice(0, 10)): Task[] {
  if (view === 'completed') return tasks.filter((task) => task.status === 'completed')

  const open = tasks.filter((task) => task.status === 'open')
  if (view === 'today') return open.filter((task) => task.dueDate === today)
  if (view === 'upcoming') return open.filter((task) => task.dueDate && task.dueDate > today)
  return open
}
