import type { Task } from '../domain/tasks'

const TASKS_KEY = 'getdone.tasks.v1'
const PROJECTS_KEY = 'getdone.projects.v1'
// Written by versions from before the app had accounts.
const LEGACY_STORAGE_KEY = 'nakul-todo.tasks.v1'
// Pre-accounts sync state, including the shared bearer token that Google
// sign-in replaced. Cleared on first sign-in so a dead secret does not sit in
// every teammate's browser forever.
const PRE_ACCOUNT_SYNC_KEYS = [
  'getdone.sync.updatedAt.v1',
  'getdone.sync.lastSyncedAt.v1',
  'getdone.sync.apiToken.v1',
  'getdone.sync.configured.v1',
]

/**
 * Local data is filed under the signed-in user's id. Teammates sharing a
 * browser profile each get their own island of tasks — without this, signing
 * out and back in as someone else would show them the previous person's list,
 * which is exactly what per-user accounts are meant to prevent.
 */
export function scopedKey(base: string, userId: string): string {
  return `${base}::${userId}`
}

function parseTasks(raw: string | null): Task[] | null {
  if (!raw) return null
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed as Task[]) : null
}

/**
 * Hands the pre-accounts task list to the first person who signs in on this
 * browser, then removes it so a second account cannot inherit it too.
 */
export function claimPreAccountTasks(userId: string): void {
  try {
    // Always drop the dead secret, whether or not there are tasks to adopt.
    for (const key of PRE_ACCOUNT_SYNC_KEYS) localStorage.removeItem(key)

    const legacy = localStorage.getItem(TASKS_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacy) return

    const target = scopedKey(TASKS_KEY, userId)
    if (localStorage.getItem(target) === null) localStorage.setItem(target, legacy)

    const legacyProjects = localStorage.getItem(PROJECTS_KEY)
    const projectTarget = scopedKey(PROJECTS_KEY, userId)
    if (legacyProjects && localStorage.getItem(projectTarget) === null) {
      localStorage.setItem(projectTarget, legacyProjects)
    }

    localStorage.removeItem(TASKS_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    localStorage.removeItem(PROJECTS_KEY)
  } catch {
    // A read-only or full quota is not worth blocking sign-in over.
  }
}

export function loadTasks(userId: string, fallback: Task[]): Task[] {
  try {
    return parseTasks(localStorage.getItem(scopedKey(TASKS_KEY, userId))) ?? fallback
  } catch {
    return fallback
  }
}

export function saveTasks(userId: string, tasks: Task[]): boolean {
  try {
    localStorage.setItem(scopedKey(TASKS_KEY, userId), JSON.stringify(tasks))
    return true
  } catch {
    return false
  }
}

export function loadProjects(userId: string, fallback: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(scopedKey(PROJECTS_KEY, userId)) ?? 'null')
    return Array.isArray(parsed) && parsed.every((name) => typeof name === 'string') && parsed.length
      ? (parsed as string[])
      : fallback
  } catch {
    return fallback
  }
}

export function saveProjects(userId: string, projects: string[]): void {
  try {
    localStorage.setItem(scopedKey(PROJECTS_KEY, userId), JSON.stringify(projects))
  } catch {
    // Task data takes precedence for the remaining quota; losing the list of
    // project names is recoverable since they are re-derived from tasks.
  }
}
