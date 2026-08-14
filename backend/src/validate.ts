export interface SnapshotEnvelope {
  schemaVersion: number
  kdfName: string
  kdfIterations: number
  salt: string
  iv: string
  updatedAt: string
  ciphertext: string
}

// Generous cap for a base64 task-list ciphertext; guards against unbounded payloads.
const MAX_CIPHERTEXT_LENGTH = 8 * 1024 * 1024

export function validateEnvelope(input: unknown): SnapshotEnvelope {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Envelope must be an object')
  }
  const value = input as Record<string, unknown>

  requireNumber(value.schemaVersion, 'schemaVersion')
  requireString(value.kdfName, 'kdfName')
  requireNumber(value.kdfIterations, 'kdfIterations')
  if (value.kdfIterations <= 0) throw new Error('kdfIterations must be positive')
  requireString(value.salt, 'salt')
  requireString(value.iv, 'iv')
  requireString(value.updatedAt, 'updatedAt')
  if (Number.isNaN(Date.parse(value.updatedAt))) throw new Error('updatedAt must be a valid ISO date')
  requireString(value.ciphertext, 'ciphertext')
  if (value.ciphertext.length > MAX_CIPHERTEXT_LENGTH) throw new Error('ciphertext exceeds maximum size')

  return {
    schemaVersion: value.schemaVersion,
    kdfName: value.kdfName,
    kdfIterations: value.kdfIterations,
    salt: value.salt,
    iv: value.iv,
    updatedAt: value.updatedAt,
    ciphertext: value.ciphertext,
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
}

function requireNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`${field} must be a number`)
}
