import type { Task } from '../domain/tasks'

const STORAGE_KEY = 'getdone.tasks.v1'
const LEGACY_STORAGE_KEY = 'nakul-todo.tasks.v1'

function parseTasks(raw: string | null): Task[] | null {
  if (!raw) return null
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed as Task[]) : null
}

export function loadTasks(fallback: Task[]): Task[] {
  try {
    const current = parseTasks(localStorage.getItem(STORAGE_KEY))
    if (current) return current

    const legacy = parseTasks(localStorage.getItem(LEGACY_STORAGE_KEY))
    if (!legacy) return fallback

    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return legacy
  } catch {
    return fallback
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}
