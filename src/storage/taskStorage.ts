import type { Task } from '../domain/tasks'

const STORAGE_KEY = 'nakul-todo.tasks.v1'

export function loadTasks(fallback: Task[]): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Task[]) : fallback
  } catch {
    return fallback
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}
