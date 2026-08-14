export interface SnapshotPayload {
  updatedAt: string
  tasks: unknown
}

export function validatePayload(input: unknown): SnapshotPayload {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Payload must be an object')
  }
  const value = input as Record<string, unknown>

  requireString(value.updatedAt, 'updatedAt')
  if (Number.isNaN(Date.parse(value.updatedAt))) throw new Error('updatedAt must be a valid ISO date')
  if (!('tasks' in value)) throw new Error('tasks is required')

  return { updatedAt: value.updatedAt, tasks: value.tasks }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
}
