import type { Task } from '../domain/tasks'

const STORAGE_KEY = 'getdone.tasks.v1'
const LEGACY_STORAGE_KEY = 'nakul-todo.tasks.v1'
const PROJECTS_KEY = 'getdone.projects.v1'

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

export function saveTasks(tasks: Task[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    return true
  } catch {
    return false
  }
}

export function loadProjects(fallback: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? 'null')
    return Array.isArray(parsed) && parsed.every((name) => typeof name === 'string') && parsed.length
      ? (parsed as string[])
      : fallback
  } catch {
    return fallback
  }
}

export function saveProjects(projects: string[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
  } catch {
    // Task data has priority for the remaining quota; losing the list of
    // project names is recoverable since they are re-derived from tasks.
  }
}
